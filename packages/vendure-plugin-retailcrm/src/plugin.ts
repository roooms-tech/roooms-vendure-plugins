import {
    VendurePlugin,
    PluginCommonModule,
    EventBus,
    Logger,
    OrderStateTransitionEvent,
    Type,
    CollectionService,
    Collection,
    ProductVariant,
} from '@vendure/core';
import { OnApplicationBootstrap } from '@nestjs/common';
import {
    createRetailcrmApi,
    RetailcrmApiOptions,
    RetailcrmApi,
    RetailcrmError,
} from '@roooms-tech/retailcrm-api';

export interface RetailCRMPluginOptions extends Omit<RetailcrmApiOptions, 'logger'> {
    logRequests?: boolean;
}

@VendurePlugin({
    imports: [PluginCommonModule],
})
export class RetailCRMPlugin implements OnApplicationBootstrap {
    private static options: RetailCRMPluginOptions;

    static init(options: RetailCRMPluginOptions): Type<RetailCRMPlugin> {
        this.options = options;
        return RetailCRMPlugin;
    }

    private loggerCtx = 'RetailCRMPlugin';
    private retailcrmApi: RetailcrmApi;

    constructor(private collectionService: CollectionService, private eventBus: EventBus) {
        if (
            !RetailCRMPlugin.options ||
            typeof RetailCRMPlugin.options.accountName !== 'string' ||
            typeof RetailCRMPlugin.options.apiKey !== 'string'
        ) {
            throw new Error(
                `Please specify accountName and apiKey with RetailCRMPlugin.init() in your Vendure config.`,
            );
        }

        this.retailcrmApi = createRetailcrmApi({
            ...RetailCRMPlugin.options,
            logger: RetailCRMPlugin.options.logRequests
                ? ({ path, body }) => {
                      Logger.debug(`${path} ${body}`, this.loggerCtx);
                  }
                : undefined,
        });
    }

    onApplicationBootstrap() {
        Logger.info(`Setting action for events for RetailCRMPlugin integration`, this.loggerCtx);

        this.eventBus
            .ofType(OrderStateTransitionEvent)
            .subscribe((event: OrderStateTransitionEvent) => {
                if (event.toState == 'PaymentSettled' || event.toState == 'PaymentAuthorized') {
                    this.createOrder(event)
                        .then(() => {
                            Logger.info(`Successfully created order`, this.loggerCtx);
                        })
                        .catch((err: unknown) => {
                            Logger.error(`Failed to create order`, this.loggerCtx, String(err));
                        });
                } else {
                    Logger.warn(
                        `Caught event OrderStateTransitionEvent with state ${event.toState}`,
                        this.loggerCtx,
                    );
                }
            });
    }

    private async createOrder({ order, ctx }: OrderStateTransitionEvent): Promise<void> {
        if (!order.customer) {
            throw new Error('order.customer is undefined!');
        }

        try {
            await this.retailcrmApi.Customer(String(order.customer.id));
        } catch (err) {
            if (err instanceof RetailcrmError && err.statusCode === 404) {
                // If customer doesn't exist, create a new one
                await this.retailcrmApi.CustomerCreate({
                    externalId: String(order.customer.id),
                    firstName: order.customer.firstName || '',
                    lastName: order.customer.lastName || '',
                    phones: [{ number: order.customer.phoneNumber || '' }],
                    email: order.customer.emailAddress || '',
                });
            } else {
                throw err;
            }
        }

        await Promise.all(
            order.lines.map((line) =>
                this.collectionService
                    .getCollectionsByProductId(ctx, line.productVariant.productId, true)
                    .then((collections: Collection[]) => {
                        line.productVariant.collections = collections;

                        return Promise.all(
                            collections.map((collection) =>
                                this.collectionService
                                    .getParent(ctx, collection.id)
                                    .then((parent) => {
                                        if (parent && !parent.isRoot) {
                                            collection.parent = parent;
                                        }
                                    }),
                            ),
                        );
                    }),
            ),
        );

        const { offers } = await this.retailcrmApi.Inventories({
            limit: 250,
            filter: {
                offerExternalId: order.lines.map((line) =>
                    computeOfferExternalId(line.productVariant),
                ),
                productActive: true,
                offerActive: true,
            },
        });

        const productsToCreate = order.lines.filter((line) => {
            const offerExternalId = computeOfferExternalId(line.productVariant);
            return offers.findIndex((offer) => offer.externalId === offerExternalId) === -1;
        });

        const createdProductsMap = new Map<string /* sku */, number /* offerId */>();

        Logger.debug(JSON.stringify(productsToCreate), 'RetailCRMPlugin');

        if (productsToCreate.length > 0) {
            const { sites } = await this.retailcrmApi.Sites();
            const catalogId = Number(Object.values(sites)[0]?.catalogId);

            const { addedProducts } = await this.retailcrmApi.ProductsBatchCreate(
                productsToCreate.map((line) => ({
                    externalId: computeProductExternalId(line.productVariant),
                    name: `[ВРЕМЕННО] ${line.productVariant.sku} / ${line.productVariant.product.name} / ${line.productVariant.name}`,
                    catalogId,
                })),
            );

            const { products } = await this.retailcrmApi.Products({
                limit: 250,
                filter: {
                    ids: addedProducts,
                },
            });

            for (const product of products) {
                const orderLine = productsToCreate.find(
                    (line) => computeProductExternalId(line.productVariant) === product.externalId,
                );
                if (orderLine) {
                    createdProductsMap.set(orderLine.productVariant.sku, product.offers[0].id);
                }
            }
        }

        await this.retailcrmApi.OrderCreate({
            externalId: String(order.code),
            // status: order.state,
            shipped: false,
            customer: { externalId: String(order.customer.id) },
            items: order.lines.map((line) => ({
                productName: line.productVariant.name,
                initialPrice: Math.ceil(line.productVariant.priceWithTax / 100),
                quantity: line.quantity,
                offer: createdProductsMap.has(line.productVariant.sku)
                    ? {
                          id: createdProductsMap.get(line.productVariant.sku) as number,
                      }
                    : {
                          externalId: computeOfferExternalId(line.productVariant),
                      },
                comment: order.shippingAddress.streetLine2,
            })),
            delivery: {
                code: order.shippingLines[0]?.shippingMethod?.code as string,
                address: {
                    text: order.shippingAddress.streetLine1 || '',
                },
            },
            payments: order.payments[0]
                ? [
                      {
                          amount: order.payments[0].amount / 100,
                          type: order.payments[0].method,
                          status: 'not-paid',
                      },
                  ]
                : [],
        });
    }
}

function computeOfferExternalId(variant: ProductVariant): string {
    const brand = findBrandCollection(variant.collections);
    return `${brand?.slug}-${variant.sku}`;
}

function computeProductExternalId(variant: ProductVariant): string {
    const brand = findBrandCollection(variant.collections);
    return `${brand?.slug}-${variant.product.slug}`;
}

function findBrandCollection(collections: Collection[]): Collection | null {
    for (const collection of collections) {
        if (
            collection.slug !== 'brand' &&
            collection.parent &&
            collection.parent.slug === 'brand'
        ) {
            return collection;
        }
    }
    return null;
}

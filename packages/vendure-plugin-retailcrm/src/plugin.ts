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
    compatibility: '^3.0.0',
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
            .subscribe({
                next: (event: OrderStateTransitionEvent) => {
                    if (event.toState === 'PaymentSettled' || event.toState === 'PaymentAuthorized') {
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
                },
                error: (err: unknown) => {
                    Logger.error(`Error in RetailCRMPlugin event subscription`, this.loggerCtx, String(err));
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

        // TODO: support more than 100 product variants in orders
        const { offers } = await this.retailcrmApi.Inventories({
            limit: 100,
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

        if (productsToCreate.length > 0) {
            const { sites } = await this.retailcrmApi.Sites();
            const catalogId = Number(Object.values(sites)[0]?.catalogId);

            const { addedProducts } = await this.retailcrmApi.ProductsBatchCreate(
                productsToCreate.map((line) => {
                    const brand = findBrandCollection(line.productVariant.collections);

                    let date = new Date().toISOString();
                    const matched = date.match(/^[\d-]{10}T[\d:]{5}/);
                    if (matched) {
                        date = matched[0];
                    }

                    return {
                        externalId:
                            `${brand?.slug}-${line.productVariant.productId}-${date}`.toLowerCase(),
                        name: `[ВРЕМЕННО] ${brand?.name} / ${line.productVariant.sku}`,
                        catalogId,
                    };
                }),
            );

            const { products } = await this.retailcrmApi.Products({
                limit: 100,
                filter: {
                    ids: addedProducts,
                },
            });

            for (const product of products) {
                const orderLine = productsToCreate.find((line) => {
                    const brand = findBrandCollection(line.productVariant.collections);
                    return (
                        product.externalId &&
                        product.externalId.startsWith(
                            `${brand?.slug}-${line.productVariant.productId}`.toLowerCase(),
                        )
                    );
                });
                if (orderLine) {
                    createdProductsMap.set(orderLine.productVariant.sku, product.offers[0].id);
                }
            }
        }

        const customFields = (order.customFields || {}) as Record<string, unknown>;

        await this.retailcrmApi.OrderCreate({
            number: order.code,
            externalId: order.code,
            status: 'new-site',
            firstName: order.customer.firstName,
            lastName: order.customer.lastName,
            phone: order.customer.phoneNumber,
            email: order.customer.emailAddress,
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
                          amount: Math.ceil(order.payments[0].amount / 100),
                          type: order.payments[0].method,
                          status: 'not-paid',
                      },
                  ]
                : [],
            customFields:
                typeof customFields.roistat === 'string'
                    ? {
                          roistat: customFields.roistat,
                      }
                    : {},
        });
    }
}

function computeOfferExternalId(variant: ProductVariant): string {
    const brand = findBrandCollection(variant.collections);
    return `${brand?.slug}-${variant.sku}`.toLowerCase();
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

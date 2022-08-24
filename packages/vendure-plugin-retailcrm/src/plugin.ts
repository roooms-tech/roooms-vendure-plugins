import {
    VendurePlugin,
    PluginCommonModule,
    EventBus,
    OrderStateTransitionEvent,
    Type,
    Logger,
} from '@vendure/core';
import { OnApplicationBootstrap } from '@nestjs/common';
import { initRetailcrmApi, RetailcrmApi, RetailcrmApiOptions, got } from './retailcrm-api';

@VendurePlugin({
    imports: [PluginCommonModule],
})
export class RetailCRMPlugin implements OnApplicationBootstrap {
    static options: RetailcrmApiOptions;

    static init(options: RetailcrmApiOptions): Type<RetailCRMPlugin> {
        this.options = options;
        return RetailCRMPlugin;
    }

    private loggerCtx = 'RetailCRMPlugin';
    private retailcrmApi: RetailcrmApi;

    constructor(private eventBus: EventBus) {
        if (
            !RetailCRMPlugin.options ||
            typeof RetailCRMPlugin.options.shopName !== 'string' ||
            typeof RetailCRMPlugin.options.accountName !== 'string' ||
            typeof RetailCRMPlugin.options.apiKey !== 'string'
        ) {
            throw new Error(
                `Please specify accountName, shopName and apiKey with RetailCRM.init() in your Vendure config.`,
            );
        }

        this.retailcrmApi = initRetailcrmApi(RetailCRMPlugin.options);
    }

    onApplicationBootstrap(): void {
        Logger.info(`Setting action for events for RetailCRM integration`, this.loggerCtx);

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

    private async createOrder({ order }: OrderStateTransitionEvent): Promise<void> {
        if (!order.customer) {
            throw new Error('order.customer is undefined!');
        }

        try {
            await this.retailcrmApi.getCustomerById(String(order.customer.id));
        } catch (err) {
            if (err instanceof (await got).HTTPError && err.code === '404') {
                // If customer doesn't exist, create a new one
                await this.retailcrmApi.createCustomer({
                    externalId: String(order.customer.id),
                    firstName: order.customer.firstName,
                    lastName: order.customer.lastName,
                    phones: [{ number: order.customer.phoneNumber }],
                    email: order.customer.emailAddress,
                });
            } else {
                throw err;
            }
        }

        await this.retailcrmApi.editStoreProductsBatch(
            order.lines.map((line) => ({
                externalId: String(line.productVariant.id),
                article: line.productVariant.sku,
                name: line.productVariant.name,
                site: RetailCRMPlugin.options.shopName,
            })),
        );

        const payments = [];
        if (order.payments[0]) {
            payments.push({
                amount: order.payments[0].amount / 100,
                type: order.payments[0].method,
                status: 'not-paid',
            });
        }

        await this.retailcrmApi.createOrder({
            externalId: order.code,
            customer: { externalId: String(order.customer.id) },
            items: order.lines.map((line) => ({
                externalIds: [
                    {
                        code: 'default',
                        value: String(line.productVariant.id),
                    },
                ],
                productName: line.productVariant.name,
                initialPrice: line.productVariant.priceWithTax / 100,
                quantity: line.quantity,
                offer: {
                    externalId: line.productVariant.sku,
                },
            })),
            delivery: {
                // TODO: match with event.order.shippingLines[0].shippingMethodId
                code: 'self-delivery',
                address: {
                    text: order.shippingAddress.streetLine1 || '',
                    // TODO: check if it works
                    notes: order.shippingAddress.streetLine2,
                },
            },
            payments,
        });
    }
}

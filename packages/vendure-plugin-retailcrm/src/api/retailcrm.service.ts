import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  EventBus,
  Logger,
  TransactionalConnection,
  VendureEvent,
  OrderStateTransitionEvent,
} from "@vendure/core";
import { RetailCRMPlugin } from "../retailcrm.plugin";
import fetch from "node-fetch";
import { loggerCtx } from "../constants";

@Injectable()
export class RetailCRMService implements OnApplicationBootstrap {
  constructor(
    private eventBus: EventBus,
    private connection: TransactionalConnection
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    Logger.info(
      `Setting action for events for RetailCRM integration`,
      loggerCtx
    );
    if (
      !RetailCRMPlugin.options ||
      !RetailCRMPlugin.options.accountName ||
      !RetailCRMPlugin.options.shopName ||
      !RetailCRMPlugin.options.apiKey
    ) {
      throw Error(
        `Please specify accountName, shopName and apiKey with RetailCRM.init() in your Vendure config.`
      );
    }
    RetailCRMPlugin.options.events!.forEach((configuredEvent) => {
      this.eventBus.ofType(configuredEvent).subscribe((event) => {
        if (event.constructor.name == "OrderStateTransitionEvent") {
          let ev: OrderStateTransitionEvent =
            event as OrderStateTransitionEvent;
          if (ev.toState == "PaymentAuthorized")
            this.createOrder(ev).catch((e) =>
              Logger.error(
                `Failed to call action for event ${event.constructor.name}`,
                loggerCtx,
                e
              )
            );
        }
      });
    });
  }

  async createOrder(event: OrderStateTransitionEvent): Promise<void> {
    //    console.log(JSON.stringify(event.order.lines, null, 4));
    try {
      const custSearchResponse = await fetch(
        `https://${
          RetailCRMPlugin.options.accountName
        }.retailcrm.ru/api/v5/customers/${event.order.customer!.id}/?apiKey=${
          RetailCRMPlugin.options.apiKey
        }&by=externalId`,
        {
          method: "GET",
        }
      );
      const custSearchData = await custSearchResponse.json();
      if (custSearchData.success == false) {
        const custParams = new URLSearchParams();
        let customer = {
          externalId: event.order.customer!.id,
          firstName: event.order.customer!.firstName,
          lastName: event.order.customer!.lastName,
          phones: [{ number: event.order.customer!.phoneNumber }],
          email: event.order.customer!.emailAddress,
        };
        custParams.append("customer", JSON.stringify(customer));

        const custCreateResponse = await fetch(
          `https://${RetailCRMPlugin.options.accountName}.retailcrm.ru/api/v5/customers/create?apiKey=${RetailCRMPlugin.options.apiKey}`,
          {
            method: "POST",
            body: custParams,
          }
        );
        const custCreateData = await custCreateResponse.json();
      }

      const productParams = new URLSearchParams();
      const tmp = 1;
      let products: {
        externalId: string;
        article: string;
        name: string;
        site: string /*, url*/;
      }[] = [];
      event.order.lines.forEach((line) => {
        products.push({
          externalId: line.productVariant.id as string,
          site: RetailCRMPlugin.options.shopName,
          article: line.productVariant.sku,
          name: line.productVariant.name,
        });
      });
      productParams.append("products", JSON.stringify(products));
      console.log(productParams);
      const productResponse = await fetch(
        `https://${RetailCRMPlugin.options.accountName}.retailcrm.ru/api/v5/store/products/batch/edit?apiKey=${RetailCRMPlugin.options.apiKey}`,
        {
          method: "POST",
          body: productParams,
        }
      );
      const productData = await productResponse.json();
      console.log(productData);

      const orderParams = new URLSearchParams();
      let items: {
        productName: string;
        initialPrice: number;
        externalId: string;
      }[] = [];
      event.order.lines.forEach((line) => {
        items.push({
          externalId: line.productVariant.id as string,
          productName: line.productVariant.name,
          initialPrice: line.productVariant.priceWithTax,
        });
      });
      let order = {
        externalId: event.order.code,
        customer: { externalId: event.order.customer!.id },
        firstName: event.order.customer!.firstName,
        lastName: event.order.customer!.lastName,
        customerComment: event.order.shippingAddress.streetLine2,
        delivery: {
          code: "self-delivery", // XXX to match with event.order.shippingLines[0].shippingMethodId
          address: { text: event.order.shippingAddress.streetLine1 },
        },
        payments: [
          {
            amount: event.order.payments[0].amount,
            type: "bank-card", // XXX to match with event.order.payments[0].method
            status: "not-paid",
          },
        ],
        items: items,
      };
      orderParams.append("order", JSON.stringify(order));
      //      console.log(orderParams);
      const orderResponse = await fetch(
        `https://${RetailCRMPlugin.options.accountName}.retailcrm.ru/api/v5/orders/create?apiKey=${RetailCRMPlugin.options.apiKey}`,
        {
          method: "POST",
          body: orderParams,
        }
      );
      const orderData = await orderResponse.json();
      //      console.log(orderData);

      Logger.info(`Successfully created order`, loggerCtx);
    } catch (e) {
      Logger.error(`Failed to create order`, loggerCtx, e);
    }
  }
}

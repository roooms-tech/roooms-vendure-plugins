import { VendureEvent } from "@vendure/core";

export interface RetailCRMPluginOptions {
  shopName: string;
  accountName: string;
  apiKey: string;
  events: {
    new (...args: any[]): VendureEvent;
  }[];
}

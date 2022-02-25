import { PluginCommonModule, VendurePlugin } from "@vendure/core";
import path from "path";
import { RetailCRMPluginOptions } from "./api/retailcrm-plugin-options";
import { RetailCRMService } from "./api/retailcrm.service";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [RetailCRMService],
  configuration: (config) => {
    return config;
  },
})
export class RetailCRMPlugin {
  static options: RetailCRMPluginOptions;

  static init(options: RetailCRMPluginOptions): typeof RetailCRMPlugin {
    this.options = options;
    return RetailCRMPlugin;
  }
}

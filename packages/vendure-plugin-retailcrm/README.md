# Vendure RetailCRM plugin

## Configuration

Configure in `vendure-config.ts`.

```js
import { RetailCRMPlugin } from '@roooms-tech/vendure-plugin-retailcrm';

plugins: [
    RetailCRMPlugin.init({
        shopName: '<shop-name>',
        accountName: '<account-name>',
        apiKey: '<api-key>',
    }),
];
```

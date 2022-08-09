# Vendure RetailCRM plugin

## vendure-config.ts

Configure in `vendure-config.ts`.

```js
import { RetailCRMPlugin } from 'vendure-plugin-retailcrm';

plugins: [
  RetailCRMPlugin.init({
    shopName: 'shop-name',
    accountName: 'account-name',
    apiKey: 'api-key',
    events: [OrderStateTransitionEvent],
  }),
];
```

# OrderCodeStrategy for Vendure

## Configuration

Configure in `vendure-config.ts`.

```js
import { ShortOrderCodeStrategy } from '@roooms-tech/vendure-order-code-strategy';

{
    orderOptions: {
        orderCodeStrategy: new ShortOrderCodeStrategy();
    }
}
```

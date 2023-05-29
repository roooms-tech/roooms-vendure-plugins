import { type OrderCodeStrategy } from '@vendure/core';
import { init } from '@paralleldrive/cuid2'

const createId = init({ length: 8 });

export class ShortOrderCodeStrategy implements OrderCodeStrategy {
    generate() {
        return createId().toUpperCase();
    }
}

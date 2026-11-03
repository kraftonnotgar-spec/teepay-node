// Create a TeePay hosted checkout and redirect the customer to it.
// Run: TEEPAY_API_KEY=tp_live_... npx tsx examples/checkout-session.ts
import { TeePay } from '@teepay/sdk';

const teepay = new TeePay(process.env.TEEPAY_API_KEY);

async function main() {
  const session = await teepay.checkoutSessions.create(
    {
      title: 'Order 1001',
      description: '2 x Coffee bag',
      amount_minor: '500000',
      currency: 'TZS',
      reference: 'order-1001',
      metadata: { cart: 'c-77' },
    },
    { idempotencyKey: 'checkout-order-1001' },
  );
  console.log('Redirect the customer to:', session.checkout_url);
  console.log('Replayed:', session.lastResponse.idempotentReplayed);

  // Later (or from your webhook handler): confirm it was paid.
  const current = await teepay.checkoutSessions.retrieve(session.id);
  if (current.status === 'paid') console.log('Paid with payment', current.payment?.reference);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

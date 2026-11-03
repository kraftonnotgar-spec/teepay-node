// Send a mobile money (USSD) payment prompt and poll until it is final.
// Run: TEEPAY_API_KEY=tp_live_... npx tsx examples/collection.ts
import TeePay, { ValidationError } from '@teepay/sdk';

const teepay = new TeePay(process.env.TEEPAY_API_KEY);

async function main() {
  const caps = await teepay.capabilities();
  if (!caps.features.collection_create) {
    console.log('Mobile money push is not enabled for this key yet.');
    return;
  }

  try {
    const payment = await teepay.collections.create(
      {
        money: { amount_minor: '500000', currency: 'TZS' }, // TZS 5,000.00
        customer: { country: 'TZ', phone: '+255712345678', name: 'Asha Juma' },
        description: 'Order 1001',
      },
      { idempotencyKey: 'order-1001' }, // derive from your own order, reuse it on retries
    );
    console.log('Prompt sent:', payment.public_reference, payment.status);

    const reference = payment.public_reference!;
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const current = await teepay.collections.retrieve(reference);
      if (current.status === 'succeeded') return console.log('Paid. Fulfil the order.');
      if (current.status === 'failed') return console.log('Not paid:', current.status_detail ?? 'failed');
    }
    console.log('Still pending; wait for the payment.completed webhook.');
  } catch (error) {
    if (error instanceof ValidationError && error.code === 'unsupported_market') {
      console.log('This country/currency is not enabled. Check capabilities.supported_countries.');
    } else {
      throw error;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

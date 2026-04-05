# SETUP\_CULQI.md

> **Last updated:** 2025 · Expo SDK 53 · Culqi API v2 · Node.js runtime (Vercel)

---

## Table of Contents

1. [Why Culqi for Peru](#1-why-culqi-for-peru)
2. [Prerequisites & Account Setup](#2-prerequisites--account-setup)
3. [API Keys & Sandbox](#3-api-keys--sandbox)
4. [Yape Integration](#4-yape-integration)
5. [Recurring Subscriptions](#5-recurring-subscriptions)
6. [Webhook Setup & Verification](#6-webhook-setup--verification)
7. [React Native / Expo Integration](#7-react-native--expo-integration)
8. [PagoEfectivo Integration](#8-pagoefectivo-integration)
9. [Pricing Reference (Centimos)](#9-pricing-reference-centimos)
10. [Go-Live Checklist](#10-go-live-checklist)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Why Culqi for Peru

### Feature Comparison vs. Stripe (2025)

| Feature | Stripe | Culqi |
|---|---|---|
| **Yape** (Peru mobile wallet) | ❌ Not supported | ✅ Native — OTP + token flows |
| **PagoEfectivo** (cash at pharmacies) | ❌ | ✅ Via Culqi dashboard |
| **PEN settlement** | ❌ USD only, converted at Stripe rate | ✅ PEN or USD, your choice |
| **Settlement timeline** | 2–7 business days (varies) | **T+1 for cards, T+2 for Yape** (next/second business day) |
| **Local card support** | Visa/MC only (limited BIN coverage) | ✅ Visa, MC, Amex, Diners — full Peru BIN coverage |
| **Peru merchant registration** | Requires US/EU legal entity | ✅ Peru RUC accepted — persona natural or jurídica |
| **Processing fee (cards)** | 2.9% + $0.30 USD | ~3.99% + IGV (Peru VAT) — [see current rates](https://culqi.com/tarifas/) |
| **Processing fee (Yape)** | ❌ N/A | ~1.99% + IGV (lower than cards) |
| **Dispute/chargeback process** | English only, US-centric | ✅ Spanish, Peru-local process |
| **SaaS subscriptions API** | ✅ Stripe Billing (mature) | ⚠️ Basic subscription object — see [Section 5](#5-recurring-subscriptions) |
| **Dashboard language** | English | ✅ Spanish |
| **Local support** | Email/chat (English) | ✅ soporte@culqi.com / +51 1 641-1200 (Spanish) |

### Yape — Why It Matters for Horario

- **14M+ active users** as of 2024, making it Peru's dominant P2P and merchant payment method ([source](https://gestion.pe/economia/empresas/yape-llego-a-los-13-millones-de-usuarios-en-peru-noticia/))
- Penetration is highest among **SMBs and freelancers** — exactly Horario's target market
- Users prefer Yape over entering card details on mobile — **lower friction = higher conversion**
- Yape transactions have **lower dispute rates** than card payments (biometric auth)

### Settlement Timeline

| Payment Method | Sandbox | Production |
|---|---|---|
| Visa / Mastercard / Amex | Instant (simulated) | **T+1 business day** |
| Yape | Instant (simulated) | **T+2 business days** |
| PagoEfectivo | Instant (simulated) | **T+3 business days** |

> Settlement goes to your Culqi wallet first, then you trigger a withdrawal to your Peruvian bank account (BCP, Interbank, BBVA, etc.) from the dashboard.

---

## 2. Prerequisites & Account Setup

### 2.1 Document Requirements

Culqi requires different documents depending on entity type. Gather these **before** starting registration to avoid back-and-forth delays.

#### Persona Natural (Sole Proprietor / Freelancer)

| Document | Notes |
|---|---|
| DNI del titular (both sides) | Must be valid — not expired |
| Ficha RUC (SUNAT) | Download from [SUNAT portal](https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp) — must show **Activo** status |
| Constancia de domicilio fiscal | Utility bill (agua, luz) dated within 3 months, matching the RUC address |

> ⚠️ **GOTCHA — Persona Natural RUC status:** Your RUC must be in **"Activo y Habido"** state in SUNAT, not "Baja de oficio" or "No Habido". Check your status at [https://e-consultaruc.sunat.gob.pe](https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp) before applying. If your RUC is "No Habido", update your fiscal address at any SUNAT office first — this can take 3–5 extra days.

#### Persona Jurídica (Company / SRL / SAC)

| Document | Notes |
|---|---|
| Ficha RUC de la empresa | Must show **Activo y Habido** |
| Partida registral (SUNARP) | Vigencia de poder del representante legal — dated within 30 days. Download from [SUNARP en línea](https://www.sunarp.gob.pe/seccion/servicios/DetalleRegistroPublico.aspx?pk=12) |
| DNI del representante legal (both sides) | The person who signs the contract |
| Contrato de sociedad or estatutos | If not visible in SUNARP partida |
| Constancia de domicilio fiscal | Utility bill matching company RUC address |

> ⚠️ **GOTCHA — SUNARP Vigencia de Poder expiry:** Culqi requires the Vigencia de Poder to be dated **within 30 calendar days** of your application. Don't download it early and let it sit — generate it the same week you apply. Cost: ~S/17 online.

### 2.2 Registration Steps

1. Go to **[https://culqi.com/registro](https://culqi.com/registro)**
2. Fill in the form:
   - **Razón social:** Your business name exactly as it appears in SUNAT/SUNARP
   - **RUC:** 11-digit number (verify at [SUNAT](https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/FrameCriterioBusquedaWeb.jsp))
   - **Rubro:** Select **"Tecnología / Software"** → then **"SaaS / Software como Servicio"**
   - **Volumen mensual estimado:** Be honest — underestimating can trigger reviews later
3. Upload all documents from Section 2.1 (PDF or JPG, max 5MB each)
4. Submit — you will receive an automated confirmation email

✅ **Verify:** You receive a confirmation email from `no-reply@culqi.com` within 15 minutes. If not, check spam or re-submit.

### 2.3 Approval Timeline

| Stage | Typical Duration |
|---|---|
| Document review | 1–2 business days |
| Risk assessment | 1–2 business days |
| Total | **2–5 business days** |

> While waiting for approval, you can use the **sandbox environment** (`integ-panel.culqi.com`) immediately after registering — no approval needed for sandbox.

✅ **Verify approval:** You receive a second email with subject **"¡Tu cuenta Culqi ha sido aprobada!"** and can now log into [https://panel.culqi.com](https://panel.culqi.com) with full access.

---

## 3. API Keys & Sandbox

### 3.1 Obtain Keys

**Sandbox dashboard:** [https://integ-panel.culqi.com](https://integ-panel.culqi.com)
**Production dashboard:** [https://panel.culqi.com](https://panel.culqi.com)

Steps (same for both environments):

1. Log in → click **Desarrollo** in the left sidebar
2. Click **→ API Keys**
3. Copy the following:

| Key | Prefix | Env Var Name |
|---|---|---|
| **Llave pública** | `pk_test_` (sandbox) / `pk_live_` (prod) | `CULQI_PUBLIC_KEY` |
| **Llave privada** | `sk_test_` (sandbox) / `sk_live_` (prod) | `CULQI_PRIVATE_KEY` |

✅ **Verify:** Public key starts with `pk_test_` for sandbox. Private key starts with `sk_test_`. If you see `pk_live_`, you are in the production panel — switch panels.

### 3.2 Add Keys to Vercel

```bash
# Sandbox (preview/development deployments)
vercel env add CULQI_PUBLIC_KEY preview
# paste pk_test_xxx...

vercel env add CULQI_PRIVATE_KEY preview
# paste sk_test_xxx...

# Production
vercel env add CULQI_PUBLIC_KEY production
# paste pk_live_xxx...

vercel env add CULQI_PRIVATE_KEY production
# paste sk_live_xxx...
```

✅ **Verify:** In the Vercel dashboard → **Settings → Environment Variables**, both `CULQI_PUBLIC_KEY` and `CULQI_PRIVATE_KEY` appear for the correct environments.

### 3.3 Sandbox Test Cards

Use these in the Culqi sandbox (`integ-panel.culqi.com`) only. Never use real card numbers in sandbox.

| Scenario | Card Number | Expiry | CVV | Expected Result |
|---|---|---|---|---|
| ✅ Approved | `4111 1111 1111 1111` | Any future | `123` | `charge.paid` |
| ✅ Approved (Visa) | `4000 0000 0000 0002` | Any future | `123` | `charge.paid` |
| ❌ Declined (generic) | `4000 0000 0000 0036` | Any future | `123` | `charge.failed` |
| ❌ Insufficient funds | `4000 0000 0000 0044` | Any future | `123` | Error code `card_declined` |
| ❌ Stolen card | `4000 0000 0000 0069` | Any future | `123` | Error code `stolen_card` |
| ❌ Expired card | `4000 0000 0000 0028` | Past date | `123` | Error code `expired_card` |
| ❌ Incorrect CVV | `4000 0000 0000 0101` | Any future | `999` | Error code `invalid_cvv` |

> Source: [Culqi sandbox documentation](https://docs.culqi.com/#/desarrollo?id=tarjetas-de-prueba) — verify this page for the latest card list as Culqi occasionally updates test numbers.

### 3.4 Sandbox Yape Credentials

| Field | Sandbox Value |
|---|---|
| Phone number | `900000000` |
| OTP code | `123456` |
| Expected result | `charge.paid` |

---

## 4. Yape Integration

### 4.1 How Yape Payments Work — Two Flows

Culqi offers **two distinct flows** for Yape. Choose based on your use case:

#### Flow A: OTP Flow (Recommended for one-time charges)

```
Customer enters phone → Yape app sends OTP → Customer enters OTP in your UI
→ Your server POSTs phone + OTP to Culqi /v2/yape → charge created
```

- **Pros:** Simple, direct, no token storage
- **Cons:** Customer must have Yape app open and available; OTP expires in ~2 minutes
- **Use for:** First payment / plan activation

#### Flow B: Token Flow (For future charges without re-auth)

```
Customer authorizes once in Culqi's hosted flow → Culqi returns a yape_token
→ Store yape_token in your DB → Use token for future charges (no OTP required)
```

- **Pros:** Enables recurring billing simulation — customer doesn't re-authorize each month
- **Cons:** Tokens can expire or be revoked by the customer in the Yape app
- **Use for:** Subscription renewals

> ⚠️ **GOTCHA — Yape does NOT support native recurring charges:** Yape is fundamentally a one-time payment method. There is no "set and forget" subscription primitive in Yape. The Token Flow above is Culqi's workaround, but it is NOT a true card-on-file subscription — the customer can revoke authorization at any time from the Yape app, and you will only discover this when the next charge fails with `yape_token_revoked`. Plan your UX for this: send a renewal warning 3 days before billing and handle failed renewals gracefully. See [Section 5](#5-recurring-subscriptions) for the full recurring billing strategy.

### 4.2 Enable Yape in the Dashboard

1. Log into **[https://panel.culqi.com](https://panel.culqi.com)**
2. Navigate to **Medios de pago → Yape**
3. Click **Activar Yape**
4. Accept the Yape addendum (requires approved account — sandbox does not need this)

✅ **Verify:** The Yape toggle shows **"Activo"** in green. In sandbox, Yape is available by default without activation.

### 4.3 OTP Flow — Complete API Implementation

This is the initial payment when a customer subscribes using Yape.

```typescript
// app/api/secure-proxy+api.ts
// Triggered by POST /api/secure-proxy with { action: 'culqi-yape-charge' }

import { auth } from '@clerk/nextjs/server';

export async function POST(request: Request) {
  // 1. Authenticate the caller via Clerk
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === 'culqi-yape-charge') {
    return handleCulqiYapeCharge(body, userId);
  }
  // ... other actions
}

async function handleCulqiYapeCharge(
  body: {
    yapePhone: string;   // e.g. "987654321" — 9 digits, no country code
    yapeOtp: string;     // 6-digit OTP from Yape app
    tier: 'starter' | 'growth' | 'pro';
    billingInterval: 'monthly' | 'annual';
    accountId: string;
  },
  userId: string
) {
  const { yapePhone, yapeOtp, tier, billingInterval, accountId } = body;

  // Validate phone format (Peru mobile: 9xxxxxxxx)
  if (!/^9\d{8}$/.test(yapePhone)) {
    return Response.json(
      { error: 'Número de teléfono inválido. Debe ser un número peruano de 9 dígitos.' },
      { status: 400 }
    );
  }

  // Validate OTP format
  if (!/^\d{6}$/.test(yapeOtp)) {
    return Response.json(
      { error: 'OTP inválido. Debe ser de 6 dígitos.' },
      { status: 400 }
    );
  }

  const amountCentimos = PRICING[tier][billingInterval]; // see Section 9

  const culqiPayload = {
    amount: amountCentimos,           // integer, e.g. 6000 for S/60.00
    currency_code: 'PEN',
    yape_number: yapePhone,           // 9-digit Peru mobile number
    otp: yapeOtp,                     // 6-digit OTP
    description: `Horario ${tier} - ${billingInterval}`,
    metadata: {
      user_id: userId,
      account_id: accountId,
      tier,
      billing_interval: billingInterval,
    },
  };

  const response = await fetch('https://api.culqi.com/v2/yape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(culqiPayload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[Culqi Yape Error]', result);
    return Response.json(
      {
        error: result.user_message ?? 'Error al procesar el pago con Yape.',
        culqi_code: result.code,
      },
      { status: response.status }
    );
  }

  // result.id is the charge ID — store in Supabase
  await recordSubscription({
    userId,
    accountId,
    tier,
    billingInterval,
    culqiChargeId: result.id,
    paymentMethod: 'yape',
    amount: amountCentimos,
    currency: 'PEN',
  });

  return Response.json({
    success: true,
    chargeId: result.id,
    outcome: result.outcome?.type, // "venta_exitosa"
  });
}

// Pricing map (centimos) — matches Section 9
const PRICING = {
  starter:  { monthly: 6000,  annual: 58368 },  // S/60 / S/583.68 (12 × S/48.64)
  growth:   { monthly: 12400, annual: 119040 }, // S/124 / S/1190.40
  pro:      { monthly: 24400, annual: 234240 }, // S/244 / S/2342.40
} as const;
```

✅ **Verify:** POST to `/api/secure-proxy` with `action: 'culqi-yape-charge'`, sandbox credentials, phone `900000000`, OTP `123456`. Response should contain `{ success: true, chargeId: "chr_live_..." }`.

### 4.4 Yape OTP UX in the Mobile App

The OTP expires in **~2 minutes** — design the UI accordingly:

```typescript
// components/YapePaymentSheet.tsx
import { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';

export function YapePaymentSheet({
  tier,
  billingInterval,
  onSuccess,
  onError,
}: YapePaymentSheetProps) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'processing'>('phone');
  const [otpTimer, setOtpTimer] = useState(120); // 2 minutes
  const [loading, setLoading] = useState(false);

  // Countdown timer once OTP step begins
  useEffect(() => {
    if (step !== 'otp') return;
    const interval = setInterval(() => {
      setOtpTimer((t) => {
        if (t <= 1) {
          clearInterval(interval);
          // OTP expired — go back to phone step
          setStep('phone');
          setOtp('');
          return 120;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  const handlePhoneSubmit = () => {
    if (!/^9\d{8}$/.test(phone)) {
      onError('Ingresa tu número Yape (9 dígitos, sin +51)');
      return;
    }
    // Instruct user to open Yape app
    setStep('otp');
  };

  const handleOtpSubmit = async () => {
    if (!/^\d{6}$/.test(otp)) {
      onError('El OTP debe ser de 6 dígitos');
      return;
    }
    setLoading(true);
    setStep('processing');

    try {
      const res = await fetch('/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'culqi-yape-charge',
          yapePhone: phone,
          yapeOtp: otp,
          tier,
          billingInterval,
          accountId: currentAccountId, // from your app state
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSuccess(data.chargeId);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error al procesar el pago');
      setStep('otp');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'phone') {
    return (
      <View>
        <Text>Ingresa tu número de Yape</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="987654321"
          maxLength={9}
        />
        <Pressable onPress={handlePhoneSubmit}>
          <Text>Continuar</Text>
        </Pressable>
      </View>
    );
  }

  if (step === 'otp') {
    return (
      <View>
        <Text>Abre la app Yape y acepta el cobro</Text>
        <Text>Ingresa el código de 6 dígitos que aparece en Yape</Text>
        {/* Countdown warning */}
        <Text style={otpTimer < 30 ? { color: 'red' } : {}}>
          Tiempo restante: {otpTimer}s
        </Text>
        <TextInput
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          placeholder="123456"
          maxLength={6}
        />
        <Pressable onPress={handleOtpSubmit}>
          <Text>Confirmar pago</Text>
        </Pressable>
        <Pressable onPress={() => setStep('phone')}>
          <Text>Cambiar número</Text>
        </Pressable>
      </View>
    );
  }

  return <ActivityIndicator size="large" />;
}
```

✅ **Verify:** In development, submit phone `900000000` and OTP `123456`. The component should reach the `processing` state and call `onSuccess`.

---

## 5. Recurring Subscriptions

### 5.1 Culqi Subscription API vs. Manual Scheduling

Culqi has a basic `/v2/subscriptions` endpoint, but it has significant limitations for SaaS:

| Capability | Culqi Subscriptions API | Manual Cron + Stored Token |
|---|---|---|
| PEN billing | ✅ | ✅ |
| Yape support | ❌ Cards only | ✅ (with token flow caveats) |
| Proration | ❌ | ✅ (you control it) |
| Trial periods | ❌ | ✅ |
| Mid-cycle upgrades | ❌ | ✅ |
| Dunning / retry logic | ❌ | ✅ (you implement) |
| **Recommendation** | ❌ Avoid for SaaS | ✅ **Use this** |

**Decision: Use manual cron-based billing** — store the customer token, charge on schedule, handle failures yourself. This is more code but gives you full control.

### 5.2 Token Lifecycle — How Culqi Tokenization Works

> ⚠️ **GOTCHA — Culqi tokens differ fundamentally from Stripe:** Stripe payment methods persist indefinitely (until the card expires or is deleted). Culqi tokens (`tkn_xxx`) are **single-use** — they expire after 5 minutes if unused. For recurring billing, you must use a **Customer + Card** object, not a raw token.

The correct flow for card-on-file:

```
Step 1: Frontend tokenizes card → Culqi returns tkn_xxx (short-lived, 5 min)
Step 2: Your server creates a Culqi Customer → Culqi returns a customer_id
Step 3: Your server attaches the token to the Customer → Culqi returns a card_id
Step 4: Store customer_id + card_id in Supabase (encrypted at rest)
Step 5: For recurring charges, POST to /v2/charges with { source_id: customer_id }
```

### 5.3 Tokenization via Culqi.js (Web / WebView)

> ⚠️ **GOTCHA — Culqi.js does NOT run in React Native:** Culqi.js relies on `window` and browser DOM APIs. It will throw in the React Native JS context. Use the approach in [Section 7](#7-react-native--expo-integration) — either a WebView with injected HTML or `expo-web-browser` pointed at a hosted checkout page. The tokenization happens in the browser context, and you receive the token back via deep link or postMessage.

### 5.4 Create a Customer and Store Card

```typescript
// app/api/secure-proxy+api.ts — action: 'culqi-store-card'

async function handleCulqiStoreCard(
  body: {
    culqiToken: string;  // tkn_xxx from Culqi.js running in browser/WebView
    email: string;
    firstName: string;
    lastName: string;
    accountId: string;
  },
  userId: string
) {
  const { culqiToken, email, firstName, lastName, accountId } = body;

  // Step 1: Create or retrieve a Culqi customer
  const customerRes = await fetch('https://api.culqi.com/v2/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email,
      address: 'Lima',            // Required field — use billing address if collected
      address_city: 'Lima',
      country_code: 'PE',
      phone_number: '51999999999', // Required — use real phone if collected
    }),
  });
  const customer = await customerRes.json();
  if (!customerRes.ok) {
    throw new Error(customer.user_message ?? 'Error al crear cliente en Culqi');
  }

  // Step 2: Attach the single-use token to create a stored card
  const cardRes = await fetch('https://api.culqi.com/v2/cards', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      customer_id: customer.id,  // cus_xxx
      token_id: culqiToken,      // tkn_xxx — single use, must use within 5 min
    }),
  });
  const card = await cardRes.json();
  if (!cardRes.ok) {
    throw new Error(card.user_message ?? 'Error al guardar la tarjeta');
  }

  // Step 3: Store in Supabase (RLS-protected table)
  // NEVER store raw card numbers — only Culqi IDs
  await supabase.from('culqi_payment_methods').upsert({
    user_id: userId,
    account_id: accountId,
    culqi_customer_id: customer.id,  // cus_xxx
    culqi_card_id: card.id,          // crd_xxx
    card_last_four: card.last_four,
    card_brand: card.brand,          // "Visa", "Mastercard", etc.
    card_expiry: `${card.expiration_month}/${card.expiration_year}`,
  });

  return Response.json({
    success: true,
    customerId: customer.id,
    cardId: card.id,
    cardLastFour: card.last_four,
    cardBrand: card.brand,
  });
}
```

✅ **Verify:** After calling this endpoint, check your Culqi sandbox dashboard → **Clientes** — you should see the new customer with a stored card. Also verify the row in your `culqi_payment_methods` Supabase table.

### 5.5 Recurring Charge Using Stored Customer

```typescript
// app/api/secure-proxy+api.ts — action: 'culqi-recurring-charge'
// Called by your monthly cron job (Vercel Cron or external scheduler)

async function handleCulqiRecurringCharge(body: {
  culqiCustomerId: string;  // cus_xxx from Supabase
  tier: 'starter' | 'growth' | 'pro';
  billingInterval: 'monthly' | 'annual';
  accountId: string;
  userId: string;
}) {
  const { culqiCustomerId, tier, billingInterval, accountId, userId } = body;

  const amountCentimos = PRICING[tier][billingInterval];

  const chargeRes = await fetch('https://api.culqi.com/v2/charges', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountCentimos,
      currency_code: 'PEN',
      email: '', // Culqi requires this — fetch from your DB before calling
      source_id: culqiCustomerId, // cus_xxx — Culqi charges the stored default card
      description: `Horario ${tier} - ${billingInterval} - renovación`,
      capture: true,
      metadata: {
        user_id: userId,
        account_id: accountId,
        tier,
        billing_interval: billingInterval,
        charge_type: 'recurring',
      },
    }),
  });

  const charge = await chargeRes.json();

  if (!chargeRes.ok || charge.outcome?.type !== 'venta_exitosa') {
    // Log failure and trigger dunning flow
    await handleFailedRecurringCharge({ userId, accountId, culqiError: charge });
    throw new Error(charge.user_message ?? 'Cargo recurrente fallido');
  }

  // Update subscription status in Supabase
  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      last_charge_id: charge.id,
    })
    .eq('account_id', accountId);

  return Response.json({ success: true, chargeId: charge.id });
}
```

### 5.6 Vercel Cron for Monthly Billing

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/billing-cron",
      "schedule": "0 10 * * *"
    }
  ]
}
```

```typescript
// app/api/billing-cron+api.ts
// Runs daily at 10:00 UTC — finds subscriptions due today and charges them

export async function GET(request: Request) {
  // Verify this is called by Vercel Cron, not a random request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().split('T')[0]; // "2025-01-15"

  // Fetch all subscriptions due today
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('*, culqi_payment_methods(*), accounts(*)')
    .eq('payment_provider', 'culqi')
    .eq('status', 'active')
    .lte('current_period_end', today);

  for (const sub of subscriptions ?? []) {
    try {
      await handleCulqiRecurringCharge({
        culqiCustomerId: sub.culqi_payment_methods.culqi_customer_id,
        tier: sub.tier,
        billingInterval: sub.billing_interval,
        accountId: sub.account_id,
        userId: sub.user_id,
      });
    } catch (err) {
      console.error(`[Billing Cron] Failed for account ${sub.account_id}:`, err);
      // Continue to next subscription — don't fail the whole cron
    }
  }

  return Response.json({ processed: subscriptions?.length ?? 0 });
}
```

✅ **Verify:** Trigger the cron manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/billing-cron`. Check Vercel logs for `[Billing Cron]` output and verify Culqi sandbox dashboard shows new charges.

---

## 6. Webhook Setup & Verification

### 6.1 Create the Webhook in Culqi Dashboard

1. Log into **[https://panel.culqi.com](https://panel.culqi.com)** (or `integ-panel.culqi.com` for sandbox)
2. Navigate to **Desarrollo → Webhooks**
3. Click **+ Nuevo Webhook**
4. Fill in the form:
   - **URL:** `https://YOUR-DOMAIN.vercel.app/api/culqi-webhook`
   - **Eventos:** Check **all** of the following:
     - `charge.paid`
     - `charge.failed`
     - `charge.refunded`
     - `yape.charge.paid`
     - `yape.charge.failed`
     - `plan.subscription.active` *(if using Culqi subscriptions)*
     - `plan.subscription.cancelled`
5. Click **Guardar**
6. Culqi will send a test `ping` event to your URL — check Vercel logs

✅ **Verify:** After saving, Culqi shows a green **"Entregado"** status next to the test ping in the webhook log. If you see **"Error"**, your endpoint URL is unreachable — check that your Vercel deployment is live.

> ⚠️ **GOTCHA — Culqi webhooks require a publicly reachable URL:** Localhost won't work. During local development, use [ngrok](https://ngrok.com/) or [Vercel dev](https://vercel.com/docs/cli/dev): `ngrok http 3000` → use the `https://xxx.ngrok.io/api/culqi-webhook` URL in the Culqi dashboard temporarily.

> ⚠️ **GOTCHA — Known Culqi webhook reliability:** Based on community reports (as of 2024), Culqi webhooks can occasionally be delayed by 5–30 minutes during high-traffic periods in Peru (evenings, payday weekends). **Do not block your UI waiting for a webhook to confirm payment.** Instead: (1) return the charge result directly from the initial API call, (2) use webhooks only for reconciliation and secondary updates. See Culqi's own note on [webhook best practices](https://docs.culqi.com/#/webhooks).

### 6.2 Webhook Signature Verification

Culqi signs webhook payloads using **HMAC-SHA256** with your webhook secret as the key. The signature is in the `x-culqi-hmac-sha256` request header.

```typescript
// app/api/culqi-webhook+api.ts
import crypto from 'crypto';

export async function POST(request: Request) {
  const rawBody = await request.text(); // Must read as raw text — NOT request.json()
  const signature = request.headers.get('x-culqi-hmac-sha256');

  if (!signature) {
    console.error('[Culqi Webhook] Missing signature header');
    return Response.json({ error: 'Missing signature' }, { status: 401 });
  }

  // Verify HMAC-SHA256 signature
  const webhookSecret = process.env.CULQI_WEBHOOK_SECRET!;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    console.error('[Culqi Webhook] Invalid signature');
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse body only AFTER verifying signature
  const event = JSON.parse(rawBody);

  console.log(`[Culqi Webhook] Event: ${event.type}, ID: ${event.data?.id}`);

  switch (event.type) {
    case 'charge.paid':
    case 'yape.charge.paid':
      await handleChargePaid(event.data);
      break;

    case 'charge.failed':
    case 'yape.charge.failed':
      await handleChargeFailed(event.data);
      break;

    case 'charge.refunded':
      await handleChargeRefunded(event.data);
      break;

    default:
      console.log(`[Culqi Webhook] Unhandled event type: ${event.type}`);
  }

  // Always return 200 — Culqi retries on non-2xx responses
  return Response.json({ received: true }, { status: 200 });
}

async function handleChargePaid(charge: CulqiCharge) {
  const { account_id, tier, billing_interval } = charge.metadata ?? {};
  if (!account_id) return;

  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      last_charge_id: charge.id,
    })
    .eq('account_id', account_id);
}

async function handleChargeFailed(charge: CulqiCharge) {
  const { account_id } = charge.metadata ?? {};
  if (!account_id) return;

  await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('account_id', account_id);

  // TODO: trigger dunning email via your email provider
}

async function handleChargeRefunded(charge: CulqiCharge) {
  const { account_id } = charge.metadata ?? {};
  if (!account_id) return;

  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('account_id', account_id);
}
```

✅ **Verify:** Use the Culqi dashboard's **"Enviar test"** button on your webhook. Check Vercel Function logs for `[Culqi Webhook] Event: charge.paid`. If you see `[Culqi Webhook] Invalid signature`, double-check that `CULQI_WEBHOOK_SECRET` in Vercel matches exactly what's shown in the Culqi dashboard (no trailing whitespace).

---

## 7. React Native / Expo Integration

### 7.1 Why WebView is Not Recommended for Culqi

A full embedded WebView for Culqi checkout has these issues:

- **Culqi.js detects WebView user agents** and may block tokenization to prevent fraud
- Deep links back into the app after checkout are fragile in WebView contexts
- App store reviewers (Apple in particular) flag WebView-based payment flows
- No native keyboard / autofill integration → poor UX for card entry

**Recommendation:** Use one of the two approaches below based on payment method.

### 7.2 Card Payments — Native UI + REST API Tokenization

Build a native card entry form in React Native, then tokenize via the Culqi REST API directly from your **server** (not from the app — never expose `sk_test_` to the client).

The correct client-side approach is to use `CULQI_PUBLIC_KEY` to tokenize from a **lightweight HTML page** loaded via `expo-web-browser`, then pass the token to your server:

```typescript
// 1. Create a minimal HTML tokenization page (host on your Vercel deployment)
// app/culqi-tokenize/page.tsx (Next.js page, not an API route)
// OR a static HTML file in /public/culqi-tokenize.html

// public/culqi-tokenize.html (simplified)
/*
<!DOCTYPE html>
<html>
<head>
  <script src="https://checkout.culqi.com/js/v4"></script>
</head>
<body>
  <div id="culqi-container"></div>
  <script>
    Culqi.publicKey = 'pk_test_xxx'; // injected server-side or via query param
    Culqi.settings({
      title: 'Horario',
      currency: 'PEN',
      description: 'Suscripción',
      amount: AMOUNT_PLACEHOLDER, // replaced server-side
    });
    Culqi.open();
    window.Culqi = function() {
      if (Culqi.token) {
        // Send token back to React Native via deep link
        window.location.href = `horario://payment-complete?token=${Culqi.token.id}`;
      }
    };
  </script>
</body>
</html>
*/
```

```typescript
// 2. In your React Native app — open the tokenization page
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

async function openCulqiCheckout(tier: string, billingInterval: string) {
  // Register the deep link handler BEFORE opening the browser
  const subscription = Linking.addEventListener('url', handleDeepLink);

  const checkoutUrl = new URL('https://your-app.vercel.app/culqi-tokenize');
  checkoutUrl.searchParams.set('tier', tier);
  checkoutUrl.searchParams.set('interval', billingInterval);
  checkoutUrl.searchParams.set('public_key', process.env.EXPO_PUBLIC_CULQI_PUBLIC_KEY!);

  const result = await WebBrowser.openAuthSessionAsync(
    checkoutUrl.toString(),
    'horario://payment-complete', // your app's deep link scheme
  );

  subscription.remove();

  if (result.type === 'cancel') {
    // User closed the browser
  }
}

function handleDeepLink(event: { url: string }) {
  const url = new URL(event.url);
  if (url.pathname === '//payment-complete') {
    const token = url.searchParams.get('token'); // tkn_xxx
    if (token) {
      // Send tkn_xxx to your server to create the customer + card
      // (see Section 5.4)
    }
  }
}
```

✅ **Verify:** After opening the checkout page in the browser and completing card entry, your app receives the deep link with `token=tkn_xxx`. Check that the token starts with `tkn_test_` in sandbox.

### 7.3 Configure the Deep Link Scheme

```json
// app.json
{
  "expo": {
    "scheme": "horario",
    "ios": {
      "bundleIdentifier": "com.yourcompany.horario"
    },
    "android": {
      "package": "com.yourcompany.horario",
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [{ "scheme": "horario" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

> ⚠️ **GOTCHA — iOS Universal Links vs. Custom Schemes:** On iOS, `WebBrowser.openAuthSessionAsync` handles the redirect back to your custom scheme (`horario://`) automatically without requiring Universal Links. Do NOT use `expo-linking` alone for this — it won't intercept the redirect from `SFSafariViewController`. Use `openAuthSessionAsync` (not `openBrowserAsync`), which is specifically designed for OAuth-style redirect flows. [Expo docs](https://docs.expo.dev/versions/latest/sdk/webbrowser/#webbrowseropenauthsessionasyncurl-redirecturl-options)

✅ **Verify:** On a physical iOS device (not simulator — simulators don't support custom schemes reliably), complete the checkout flow and confirm the app re-opens automatically.

---

## 8. PagoEfectivo Integration

### 8.1 What Is PagoEfectivo?

PagoEfectivo allows customers to pay cash at 3,000+ locations across Peru:
- **Farmacias:** Inkafarma, MiFarma, Boticas Arcangel
- **Bodegas / agents:** Via agents network
- **BCP, Interbank, BBVA:** Via bank apps (code entry)

**Why it matters for Horario:** Reaches customers without debit/credit cards or Yape — estimated 30–40% of Peru's adult population is underbanked.

**Typical flow:**
1. Customer selects "PagoEfectivo" at checkout
2. Your server generates a CIP (Código de Identificación de Pago) via Culqi API
3. Customer receives CIP code (9–15 digits)
4. Customer goes to any participating location and pays cash using the CIP
5. Culqi sends `charge.paid` webhook when payment is confirmed (usually within minutes)

### 8.2 Enable PagoEfectivo

1. Log into **[https://panel.culqi.com](https://panel.culqi.com)**
2. Navigate to **Medios de pago → PagoEfectivo**
3. Click **Activar PagoEfectivo**
4. Accept PagoEfectivo's addendum (Culqi handles the PagoEfectivo relationship)

✅ **Verify:** PagoEfectivo shows **"Activo"** status. In sandbox, test with the PagoEfectivo sandbox flow — CIP codes are generated but payment is simulated.

### 8.3 Generate a CIP Code

```typescript
// app/api/secure-proxy+api.ts — action: 'culqi-pagoefectivo'

async function handlePagoEfectivo(
  body: {
    email: string;
    tier: 'starter' | 'growth' | 'pro';
    billingInterval: 'monthly' | 'annual';
    accountId: string;
    firstName: string;
    lastName: string;
    phone: string;
  },
  userId: string
) {
  const amountCentimos = PRICING[body.tier][body.billingInterval];

  // CIP codes expire after 3 days by default — set longer for subscriptions
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .split('.')[0]; // Format: "2025-01-18 10:00:00"

  const response = await fetch('https://api.culqi.com/v2/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountCentimos,
      currency_code: 'PEN',
      description: `Horario ${body.tier} - ${body.billingInterval}`,
      order_number: `HORARIO-${Date.now()}`, // Your internal order ref
      client_details: {
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email,
        phone_number: body.phone,
      },
      expiration_date: Math.floor(
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).getTime() / 1000
      ), // Unix timestamp 3 days from now
      confirm: false, // Set true to require email confirmation
      metadata: {
        user_id: userId,
        account_id: body.accountId,
        tier: body.tier,
        billing_interval: body.billingInterval,
      },
    }),
  });

  const order = await response.json();
  if (!response.ok) {
    throw new Error(order.user_message ?? 'Error al generar código PagoEfectivo');
  }

  // order.cuotealo_info.cip is the payment code
  // order.cuotealo_info.cip_url is a printable/shareable URL

  // Store pending order in Supabase
  await supabase.from('pending_payments').insert({
    user_id: userId,
    account_id: body.accountId,
    provider: 'culqi_pagoefectivo',
    order_id: order.id,
    cip_code: order.cuotealo_info?.cip,
    cip_url: order.cuotealo_info?.cip_url,
    amount: amountCentimos,
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    status: 'pending',
  });

  return Response.json({
    cipCode: order.cuotealo_info?.cip,
    cipUrl: order.cuotealo_info?.cip_url,
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    orderId: order.id,
  });
}
```

### 8.4 Show CIP Code to Customer

```typescript
// In your React Native app after receiving the CIP
function PagoEfectivoConfirmation({ cipCode, cipUrl, expiresAt }) {
  return (
    <View>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{cipCode}</Text>
      <Text>Paga este código en cualquier Inkafarma, MiFarma o agente BCP</Text>
      <Text>Vence: {new Date(expiresAt).toLocaleDateString('es-PE')}</Text>
      <Pressable onPress={() => Share.share({ url: cipUrl, message: `Tu código PagoEfectivo: ${cipCode}` })}>
        <Text>Compartir código</Text>
      </Pressable>
    </View>
  );
}
```

✅ **Verify:** The API returns a `cipCode` (9–15 digit string) and a `cipUrl`. Check your Culqi sandbox dashboard → **Órdenes** to see the pending order.

---

## 9. Pricing Reference (Centimos)

All amounts are integers in centimos (1 sol = 100 centimos). Pass directly to Culqi `amount` field.

| Tier | Monthly (PEN) | Monthly centimos | Annual total (PEN) | Annual centimos | Annual per-month equiv |
|---|---|---|---|---|---|
| **Starter** | S/60.00 | `6000` | S/583.68 | `58368` | S/48.64 |
| **Growth** | S/124.00 | `12400` | S/1,190.40 | `119040` | S/99.20 |
| **Pro** | S/244.00 | `24400` | S/2,342.40 | `234240` | S/195.20 |

```typescript
// constants/pricing.ts — single source of truth
export const CULQI_PRICING = {
  starter: {
    monthly: 6000,   // S/60.00
    annual:  58368,  // S/583.68 (20% discount = 12 × S/48.64)
  },
  growth: {
    monthly: 12400,  // S/124.00
    annual:  119040, // S/1,190.40
  },
  pro: {
    monthly: 24400,  // S/244.00
    annual:  234240, // S/2,342.40
  },
} as const;

export type CulqiTier = keyof typeof CULQI_PRICING;
export type BillingInterval = keyof (typeof CULQI_PRICING)[CulqiTier];

// Helper: get amount in centimos
export function getCulqiAmount(tier: CulqiTier, interval: BillingInterval): number {
  return CULQI_PRICING[tier][interval];
}

// Helper: format for display
export function formatPEN(centimos: number): string {
  return `S/${(centimos / 100).toFixed(2)}`;
}
// formatPEN(6000) → "S/60.00"
```

---

## 10. Go-Live Checklist

```
ACCOUNT & LEGAL
[ ] 1. Culqi merchant account approved (email received: "¡Tu cuenta Culqi ha sido aprobada!")
[ ] 2. Production panel accessible at https://panel.culqi.com
[ ] 3. Yape activated in production panel (Medios de pago → Yape → Activo)
[ ] 4. PagoEfectivo activated (if offering cash payments)
[ ] 5. Bank account linked in Culqi for PEN withdrawals

API KEYS
[ ] 6. Production keys copied: pk_live_xxx → CULQI_PUBLIC_KEY (production env in Vercel)
[ ] 7. Production keys copied: sk_live_xxx → CULQI_PRIVATE_KEY (production env in Vercel)
[ ] 8. CULQI_WEBHOOK_SECRET set in Vercel production env
[ ] 9. EXPO_PUBLIC_CULQI_PUBLIC_KEY set for production in eas.json / app.config.ts
[ ] 10. Verify NO test keys (pk_test_ / sk_test_) are set in production env

WEBHOOKS
[ ] 11. Production webhook URL set: https://your-domain.vercel.app/api/culqi-webhook
[ ] 12. All events selected: charge.paid, charge.failed, charge.refunded, yape.*
[ ] 13. Test ping from Culqi dashboard shows "Entregado" status

PAYMENTS
[ ] 14. End-to-end test with a real Peruvian Visa/MC card (small amount, then refund)
[ ] 15. End-to-end test with a real Yape account (minimum S/1.00)
[ ] 16. Recurring charge tested: manually trigger billing-cron for a test account
[ ] 17. Failed charge tested: verify account moves to past_due status in Supabase

DEEP LINKS (mobile)
[ ] 18. iOS: custom scheme horario:// tested on physical device (not simulator)
[ ] 19. Android: intent filter tested on physical device
[ ] 20. Token received via deep link after card tokenization in expo-web-browser

COMPLIANCE
[ ] 21. Privacy policy updated to mention Culqi as payment processor
[ ] 22. Terms of service include cancellation/refund policy (Culqi requires this)
[ ] 23. Culqi logo displayed at checkout per their branding requirements

MONITORING
[ ] 24. Vercel log alerts configured for [Culqi Webhook] errors
[ ] 25. Supabase alert on subscriptions table where status = 'past_due' > X rows
[ ] 26. Culqi support contact saved: soporte@culqi.com / +51 1 641-1200
```

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized` from Culqi API | Wrong API key or key for wrong environment | Verify `CULQI_PRIVATE_KEY` starts with `sk_test_` (sandbox) or `sk_live_` (production). Check Vercel env → **Settings → Environment Variables** — confirm the correct env is selected. |
| `Token expired` error when creating a card | Culqi tokens (`tkn_xxx`) expire after 5 minutes | Store the token immediately after tokenization. If the user takes >5 min, re-open the tokenization flow to generate a fresh token. |
| Yape charge returns `otp_expired` | OTP from Yape app is >2 minutes old | Show a countdown timer in UI (see Section 4.4). If expired, prompt user to re-open Yape and generate a new OTP. |
| Yape charge returns `yape_number_not_found` | Phone number not registered in Yape | Validate that phone starts with `9` and is 9 digits. Display error: "Este número no está registrado en Yape". |
| Webhook signature validation fails | `CULQI_WEBHOOK_SECRET` mismatch or body parsed as JSON before verification | Ensure you read the body with `request.text()` (raw), not `request.json()`. Copy the webhook secret from Culqi dashboard again — check for invisible trailing spaces. |
| Webhook shows `Error` status in Culqi dashboard | Your endpoint returned non-2xx | Always return `200` from your webhook handler even for unhandled events. Check Vercel function logs for exceptions thrown before the response. |
| `charge.paid` webhook not received | Culqi webhook delay (up to 30 min in peak hours) | Don't block UI on webhook — use the initial API response as source of truth. Treat webhooks as reconciliation only. |
| Deep link not triggered on iOS | Using `openBrowserAsync` instead of `openAuthSessionAsync` | Replace with `WebBrowser.openAuthSessionAsync(url, 'horario://payment-complete')` — this uses SFSafariViewController which intercepts the redirect. |
| Deep link not triggered on Android | Missing intent filter in app.json | Add the `intentFilters` block from Section 7.3 to `app.json`. Run `expo prebuild` and rebuild the native app. |
| `Invalid amount` from Culqi API | Amount is a float or zero | Amount must be a **positive integer** in centimos. `S/60.00 → 6000`, not `60.0` or `60`. Use `Math.round()` if computing from floats. |
| `customer_id not found` on recurring charge | Customer was created in sandbox but code is using production keys | Culqi customers are environment-specific. Verify `CULQI_PRIVATE_KEY` matches the environment where the `cus_xxx` was created. |
| PagoEfectivo CIP not showing payment as confirmed | Payment not yet processed by PagoEfectivo network | Normal — can take up to 30 minutes after cash payment. UI should show "Pago en proceso" and update when `charge.paid` webhook arrives. |
| Culqi.js tokenization fails in WebView | Culqi.js blocks WebView user agents | Do not use Culqi.js inside a React Native WebView. Use `expo-web-browser` (`openAuthSessionAsync`) to open the tokenization page in the system browser. |
| RUC shows "No Habido" during registration | SUNAT fiscal address not updated | Visit a SUNAT office with DNI and utility bill to update your fiscal address. Can take 3–5 business days to reflect. Required before Culqi can approve your account. |

---

> **Questions?** Culqi technical support: **soporte@culqi.com** / **+51 1 641-1200** (Mon–Fri 9am–6pm PET)
>
> **Culqi API Reference:** [https://docs.culqi.com](https://docs.culqi.com)
>
> **Culqi Status Page:** [https://status.culqi.com](https://status.culqi.com) — bookmark this for incident tracking
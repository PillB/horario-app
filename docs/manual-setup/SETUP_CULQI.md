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
10. [RSA Payload Encryption](#10-rsa-payload-encryption)
11. [Go-Live Checklist](#11-go-live-checklist)
12. [Troubleshooting](#12-troubleshooting)
13. [References](#13-references)

---

## 1. Why Culqi for Peru

### Feature Comparison vs. Stripe (2025)

| Feature | Stripe | Culqi |
|---|---|---|
| **Yape** (Peru mobile wallet) | ❌ Not supported | ✅ Native — OTP + token flows |
| **PagoEfectivo** (cash at pharmacies) | ❌ | ✅ Via Culqi dashboard |
| **PEN settlement** | ❌ USD only, converted at Stripe rate | ✅ PEN or USD, your choice |
| **Settlement timeline** | 2–7 business days (varies) | **T+1 for cards, T+2 for Yape** |
| **Local card support** | Visa/MC only (limited BIN coverage) | ✅ Visa, MC, Amex, Diners — full Peru BIN coverage |
| **Peru merchant registration** | Requires US/EU legal entity | ✅ Peru RUC accepted — persona natural or jurídica |
| **Processing fee (cards)** | 2.9% + $0.30 USD | ~3.99% + IGV — [see current rates](https://culqi.com/tarifas/) |
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

> ⚠️ **GOTCHA — Server-side direct API token creation requires PCI DSS compliance AND explicit merchant enablement:** If you call the Culqi token API directly from your server (rather than using CulqiJS v4 in a browser), Culqi requires two things: (1) you must fill and submit the **SAQ-D PCI DSS form** to `riesgos@culqi.com`, and (2) your merchant account must be explicitly enabled for direct token creation by Culqi support. Without this enablement, you will receive `"Tu código de comercio no está habilitado"` errors even with valid credentials. Contact `soporte@culqi.com` to request this. (source: https://github.com/culqi/culqi-php, https://www.npmjs.com/package/culqi-node)

### 3.2 🔄 UPDATED: No Official Node.js SDK — Use Raw HTTP Calls

**There is no official Culqi Node.js SDK.** The official Culqi GitHub organization publishes SDKs for PHP, Python, Ruby, Go, .NET, Java, Android, and iOS — but not Node.js. (source: https://github.com/culqi)

The community package `culqi-node` (by giwiro, v2.1.0) is the only available Node.js wrapper, but it has critical limitations:

| Capability | `culqi-node` community package | Raw `fetch` to Culqi API |
|---|---|---|
| Card token creation (server-side, PCI) | ✅ (with `pciCompliant: true`) | ✅ |
| Charges, refunds, customers, cards | ✅ | ✅ |
| **Yape token endpoint (`/v2/tokens/yape`)** | ❌ **Not supported** | ✅ |
| **RSA payload encryption** | ❌ **Not supported** | ✅ (manual implementation required — see Section 10) |
| Plans and subscriptions | ✅ | ✅ |
| Last published | 3 years ago | N/A |

> ⚠️ **GOTCHA — `culqi-node` does NOT support Yape tokens or RSA encryption:** For all Yape token creation calls (`/v2/tokens/yape`) and any RSA-encrypted payload, you must make raw `fetch` or `axios` HTTP calls — the community wrapper has no equivalent. Do not attempt to use `culqi-node` for these operations. (source: https://github.com/giwiro/culqi-node, https://www.npmjs.com/package/culqi-node)

> ⚠️ **GOTCHA — `culqi2` npm package is deprecated:** The `culqi2` package by jotarios is explicitly marked deprecated. Do not install it. (source: https://github.com/jotarios/culqi-nodejs-wrapper)

**Recommendation:** Use raw `fetch` calls throughout this manual rather than the community wrapper. All code examples below use `fetch` directly.

### 3.3 Add Keys to Vercel

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

### 3.4 🔄 UPDATED: Log `x-culqi-tracking-id` on Every API Call

Every Culqi API response includes an `x-culqi-tracking-id` header. This is the primary identifier Culqi support uses to investigate issues. **Log it on every call.** (source: https://github.com/heroseven/api-docs)

```typescript
// utils/culqi-fetch.ts — wrapper for all Culqi API calls

export async function culqiFetch(
  endpoint: string,
  options: RequestInit
): Promise<{ data: unknown; trackingId: string | null; ok: boolean; status: number }> {
  const response = await fetch(`https://api.culqi.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.CULQI_PRIVATE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const trackingId = response.headers.get('x-culqi-tracking-id');
  const data = await response.json();

  if (!response.ok) {
    console.error(
      `[Culqi API Error] ${endpoint} → ${response.status}`,
      `tracking-id: ${trackingId}`,
      data
    );
  } else {
    console.log(
      `[Culqi API] ${endpoint} → ${response.status}`,
      `tracking-id: ${trackingId}`
    );
  }

  return { data, trackingId, ok: response.ok, status: response.status };
}
```

> ⚠️ **GOTCHA — Always capture `x-culqi-tracking-id`:** When filing a support ticket with Culqi (`soporte@culqi.com`), you will be asked for this value. Without it, Culqi support cannot locate the transaction in their system. Store it in your logs alongside every charge attempt. (source: https://github.com/heroseven/api-docs)

### 3.5 Sandbox Test Cards

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

### 3.6 Sandbox Yape Credentials

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

> ⚠️ **GOTCHA — Yape does NOT support native recurring charges:** Yape is fundamentally a one-time payment method. There is no "set and forget" subscription primitive in Yape. The Token Flow above is Culqi's workaround, but it is NOT a true card-on-file subscription — the customer can revoke authorization at any time from the Yape app, and you will only discover this when the next charge fails with `yape_token_revoked`. Plan your UX for this: send a renewal warning 3 days before billing and handle failed renewals gracefully. See [Section 5](#5-recurring-subscriptions) for the full recurring billing strategy. (source: https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens-yape/)

### 4.2 🔄 UPDATED: Yape Hard Constraints

Before building, internalize these non-negotiable Yape limits:

| Constraint | Value | Source |
|---|---|---|
| **Maximum charge amount** | S/2,000 per transaction | Culqi-enforced |
| **Currency** | PEN only — USD rejected | Culqi API |
| **Token lifetime** | 5 minutes — single use | Culqi token vault |
| **Yape token prefix** | `ype_live_xxx` / `ype_test_xxx` (not `tkn_`) | Culqi API |
| **User daily send limit (user-controlled)** | S/500, S/950, or S/2,000 — set by the user | Yape app settings |
| **PCI DSS** | SAQ-D required if creating tokens server-side | Culqi policy |

> ⚠️ **GOTCHA — Yape user daily limits can silently fail payments:** Culqi enforces a S/2,000 per-transaction cap, but individual Yape users can set their own daily sending limit as low as S/500 within the Yape app. A subscription charge of S/600 may fail not because Culqi rejected it, but because the user's personal Yape limit is S/500. When a charge fails for this reason, display a user-friendly message: *"Tu límite de envío de Yape es menor al monto. Aumenta tu límite en la app de Yape (Ajustes → Límite de envío) e intenta nuevamente."* (source: https://www.yape.com.pe/preguntas-frecuentes/crear-tu-cuenta-yape/25--cual-es-el-monto-maximo-de-envio-y-recepcion-de-dinero-si-me-registre-con-mi-tarjeta-de-debito-bcp)

> ⚠️ **GOTCHA — Yape tokens are NOT `tkn_` prefixed:** Yape token IDs use the `ype_` prefix (`ype_live_xxx`, `ype_test_xxx`). If your code validates token format and checks for `tkn_`, it will incorrectly reject valid Yape tokens. Keep card token validation and Yape token validation separate. (source: https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens-yape/)

### 4.3 Enable Yape in the Dashboard

1. Log into **[https://panel.culqi.com](https://panel.culqi.com)**
2. Navigate to **Medios de pago → Yape**
3. Click **Activar Yape**
4. Accept the Yape addendum (requires approved account — sandbox does not need this)

✅ **Verify:** The Yape toggle shows **"Activo"** in green. In sandbox, Yape is available by default without activation.

### 4.4 OTP Flow — Complete API Implementation

This is the initial payment when a customer subscribes using Yape. Note that this uses a raw `fetch` call — **not** `culqi-node` — because the community wrapper does not expose the Yape endpoint.

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

  // Yape charges over S/2,000 are rejected by Culqi — validate before calling
  if (amountCentimos > 200000) {
    return Response.json(
      { error: 'El monto supera el límite de Yape de S/2,000.' },
      { status: 400 }
    );
  }

  const culqiPayload = {
    amount: amountCentimos,           // integer, e.g. 6000 for S/60.00
    currency_code: 'PEN',            // Yape only accepts PEN
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

  // Capture tracking ID for support/debugging
  const trackingId = response.headers.get('x-culqi-tracking-id');
  const result = await response.json();

  if (!response.ok) {
    console.error('[Culqi Yape Error]', {
      trackingId,
      status: response.status,
      result,
    });
    return Response.json(
      {
        error: result.user_message ?? 'Error al procesar el pago con Yape.',
        culqi_code: result.code,
        tracking_id: trackingId,
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
    trackingId,
  });
}

// Pricing map (centimos) — matches Section 9
const PRICING = {
  starter:  { monthly: 6000,  annual: 58368 },  // S/60 / S/583.68 (12 × S/48.64)
  growth:   { monthly: 12400, annual: 119040 }, // S/124 / S/1190.40
  pro:      { monthly: 24400, annual: 234240 }, // S/244 / S/2342.40
} as const;
```

✅ **Verify:** POST to `/api/secure-proxy` with `action: 'culqi-yape-charge'`, sandbox credentials, phone `900000000`, OTP `123456`. Response should contain `{ success: true, chargeId: "chr_test_..." }` and a `trackingId`.

### 4.5 Yape OTP UX in the Mobile App

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
|
# Culqi — Research Findings (v2)

I'll run all five searches simultaneously to gather information on Culqi integration gotchas.
Now let me fetch the most relevant pages for deeper detail:
The main Culqi docs returned almost no content (likely JS-rendered). Let me try alternative sources with more content:
The Culqi docs are heavily JS-rendered. Let me run more targeted searches to find deeper content from cached/indexed versions and community posts:
GitHub is returning minimal content. Let me try different approaches — searching for community content and blog posts:
Now I have substantial data. Let me run a couple more focused searches on the webhook and Expo-specific topics:
Now I have enough data. Let me compile the research summary.

---

## Research Summary: Culqi Integration Gotchas for Horario (SETUP\_CULQI.md)

---

## Findings

### Node.js SDK Landscape — Fragmented and Stale
- **The `culqi-node` package (by giwiro) is the only actively maintained Node.js wrapper**, at version 2.1.0 — but 
it was last published 3 years ago
. It's a 
TypeScript wrapper with 0 runtime dependencies
.
  - Source: https://www.npmjs.com/package/culqi-node
- **The `culqi2` npm package (by jotarios) is explicitly deprecated.** 
It's marked "Deprecated: A Culqi API wrapper for Node.js"
.
  - Source: https://github.com/jotarios/culqi-nodejs-wrapper
- **Culqi has NO official Node.js SDK.** The official Culqi GitHub org has SDKs for PHP, Python, Ruby, Go, .NET, Java, Android, and iOS — 
Biblioteca que permite integrar la pasarela de pagos CULQI... Biblioteca de Culqi en iOS... Biblioteca de Culqi en Android
 — but no official Node.js library.
  - Source: https://github.com/culqi

### `culqi-node` Does NOT Support Yape Tokens or RSA Encryption
- The community `culqi-node` package only covers basic operations: tokens (card), charges, refunds, customers, cards, plans, subscriptions. 
In a regular flow, some other culqi frontend library such as the Android or CulqiJS, would generate the token in a "safe" way. That token is going to be the input for generating charges.

- **No Yape token endpoint** is exposed in `culqi-node`. Yape token creation (`/v2/tokens/yape`) must be done via raw HTTP calls.
- **No RSA payload encryption support.** The official PHP/Python/Go/Ruby SDKs all support RSA encryption parameters (`rsa_public_key`, `rsa_id`), e.g. 
Para encriptar el payload debes generar un id y llave RSA ingresando a CulqiPanel > Desarrollo > RSA Keys
. The `culqi-node` wrapper has no equivalent.
  - Source: https://github.com/giwiro/culqi-node, https://github.com/culqi/culqi-php

### RSA Payload Encryption — Now Expected for Production
- 
Culqi proporciona un mecanismo de encriptación híbrido AES/RSA entre tus servidor y Culqi, resguardando los datos en tránsito y brindando un segundo factor de protección, ya que cifra los datos y los protege contra cualquier acceso ilícito. La data sensible del payload se encripta con AES-256-GCM (encriptación simétrica) con un "key" e "iv" generados aleatoriamente, luego se encripta el "key" e "iv" con la llave pública RSA (encriptación asimétrica) y el algoritmo "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
.
- 
Cada entorno (producción / integración) maneja llaves RSA distintas por lo que deben ser creadas de forma independiente.

  - Source: https://docs.culqi.com/es/documentacion/pagos-online/llaves_rsa/

### Yape Token — Critical Constraints
- 
Los pagos con Yape tienen un monto máximo de S/ 2000. Ten en cuenta que solo se reciben pagos en soles.

- 
El token tiene un tiempo de vida de 5 minutos y solo se puede usar una vez.
 After 5 minutes or after use, the phone/OTP data is purged from Culqi's vault.
- The Yape token format is distinct: `ype_live_XXXXXX` or `ype_test_XXXXX` (not `tkn_*`).
- 
En caso se use el API directamente, es responsabilidad del comercio cumplir con la normativa PCI DSS.

  - Source: https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens/, https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens-yape/

### Yape Per-User Daily Limits (External to Culqi)
- 
Con Yape, puedes enviar hasta S/ 500 por yapeo. Tu límite total por día podrá ser de S/ 500, S/ 950 o S/ 2,000.
 This is a Yape-side limit users set themselves, independent of the Culqi S/2000 per-transaction cap.
  - Source: https://www.yape.com.pe/preguntas-frecuentes/crear-tu-cuenta-yape/25--cual-es-el-monto-maximo-de-envio-y-recepcion-de-dinero-si-me-registre-con-mi-tarjeta-de-debito-bcp

### PCI DSS SAQ-D Required for Direct API Token Creation
- 
Recuerda que cuando interactúas directamente con el API Token necesitas cumplir la normativa de PCI DSS 3.2. Por ello, te pedimos que llenes el formulario SAQ-D y lo envíes al buzón de riesgos Culqi.
 This applies to both card and Yape tokens if created server-side.
  - Source: https://github.com/culqi/culqi-php

### Server-Side Token Creation Requires `pciCompliant: true` Flag
- 
Normally you wouldn't create the token by yourself. To do so, or if any credit card data goes through your server, you will need to be PCI compliant. In order to create a token, you will need to create a Culqi instance a bit differently. You will need to provide the pciCompliant property as true and publicKey.

  - Source: https://www.npmjs.com/package/culqi-node

### 3DS Authentication Is Mandatory for Card Charges
- 
Culqi3DS es una librería que permite a los comercios integrar la autenticación 3DS al flujo de generación de cargos, siendo mandatorio y disponible en todas las librerías
.
- The 3DS flow requires a **two-step charge**: first create a charge attempt, then authenticate with `Culqi3DS.initAuthentication(tokenId)`, then 
se manda al servicio de https://api.culqi.com/v2/charges por segunda vez para generación del cargo después de pasar por la autenticación 3DS
.
  - Source: https://docs.culqi.com/es/documentacion/culqi-3ds/, https://docs.culqi.com/es/documentacion/culqi-3ds/v1/uso-libreria/

### CulqiJS v4 / Checkout v4 — Required for Frontend Token Generation
- 
Dependiendo del resultado, se podrá obtener 3 objetos: "token": con la función generate() te permitirá generar el token ID para el caso de pagos con tarjetas.

- Yape tokens via CulqiJS v4 use a separate `yape.generate()` function: 
Crea tu formulario de captura de datos del número de teléfono y el código de aprobación. En este paso, el cliente ingresa su número telefónico vinculado con yape y el código de aprobación obtenida desde su aplicativo Yape para que CulqiJS pueda crear el objeto token usando la función yape.generate().

- Must call `Culqi.validationPaymentMethods()` before displaying payment options.
  - Source: https://docs.culqi.com/es/documentacion/culqi-js/v4/culqi-js/

### Webhooks — Event-Based Configuration in CulqiPanel
- 
Dirígete a tu CulqiPanel en la sección Eventos, opción Webhooks, y +Añadir. Selecciona el webhook a configurar y pega la URL de tu tienda virtual para notificar los pagos.

- 
Puedes elegir los eventos asociados a: Tokens, Cargos, Devoluciones, Clientes, Tarjetas, Planes, Suscripciones y Órdenes.

- For PagoEfectivo, the key event is `order.status.changed`: 
Cuando tu cliente haya realizado el pago, recibirás una notificación vía Webhooks... con el evento order.status.changed.

- **No HMAC/signature verification documented.** Culqi's webhook docs don't mention any signature verification mechanism — this is a significant security gap vs Stripe.
  - Source: https://docs.culqi.com/es/documentacion/pagos-online/webhooks/

### No Official React Native Library — WebView Is the Path
- There is **no Culqi React Native SDK**. The `react-culqi` package is a community React (web) library by klujanrosas that 
is for integration with Culqi payments processor
 but targets React DOM, not React Native.
- The Culqi-official `culqi-reactjs-demo-jsv4` repo 
integra Culqi ReactJS, Culqi JS V4, es compatible con la v2.0 del Culqi API
 — but this is a web React demo, not React Native.
- For React Native/Expo, the only viable approach is loading CulqiJS v4 inside a `react-native-webview` WebView.
  - Source: https://github.com/klujanrosas/react-culqi, https://github.com/culqi/culqi-reactjs-demo-jsv4

### Expo SDK 53 → SDK 55 Transition
- 
If you use Expo, React Native 0.83 will be available in SDK 55, which will be released in January 2026.

- There was an Expo bug with React 19 version mismatches: 
applying these upgrades in an Expo-managed React Native project results in a critical version mismatch error: [Error: Incompatible React versions: The "react" and "react-native-renderer" packages must have the exact same version.]

  - Source: https://reactnative.dev/blog/2025/12/10/react-native-0.83, https://github.com/expo/expo/issues/41397

### API Error Codes
- The API docs (via heroseven/api-docs mirror) document specific error scenarios: 
The authentication header is not present. You must authenticate using your Trade Code (public key) or API Key (secret key) as Bearer Token... The API Key used is invalid... The Used Trade Code is invalid... Authentication failed. Your trade is disabled.

- 
Invalid token or expired token... Token with corrupted data, some parameter invalid. Try to create a new one... The card's expiration year is invalid... The card's expiration month is invalid... The security code (CVV) of the card is invalid.

  - Source: https://github.com/heroseven/api-docs

### Error Tracking via `x-culqi-tracking-id`
- 
Each request API is associated with a request identifier (request). You can find this value in the response headers, under the name of x-culqi-tracking-id.
 This is essential for debugging with Culqi support.
  - Source: https://github.com/heroseven/api-docs

---

## New Gotchas (not in existing manual)

1. **`culqi-node` does NOT support Yape tokens or RSA encryption.** The manual should warn developers that for Yape token creation and RSA-encrypted payloads, they must make raw `fetch`/`axios` calls to the Culqi API — the community Node wrapper only covers basic card token/charge operations.

2. **RSA payload encryption is hybrid AES-256-GCM + RSA with a specific algorithm (`RSA/ECB/OAEPWithSHA-256AndMGF1Padding`).** This must be implemented manually in Node.js since there's no official SDK. The encryption requires generating random AES key+IV, encrypting payload with AES-GCM, then encrypting the key+IV with the RSA public key. Each environment (test vs live) needs separately generated RSA keys.

3. **3DS is mandatory for card charges** — the manual should emphasize the two-step charge flow: (1) create initial charge → (2) `Culqi3DS.initAuthentication(token)` → (3) re-submit charge with 3DS data. This is a frontend concern that complicates the WebView approach in React Native.

4. **No webhook signature verification mechanism exists.** Unlike Stripe's `webhook-secret`/HMAC approach, Culqi webhooks have no documented signature verification. The manual's Section 6 ("Webhook Setup & Verification") should note that verification must be done via alternative means (IP allowlisting, secret URL paths, or verifying the charge via API callback).

5. **Yape user-side daily limits can silently fail payments.** Users can set their own Yape daily limit as low as S/500. A subscription charge of S/600 may fail not because of Culqi's S/2000 cap but because of the user's personal daily Yape limit.

6. **CulqiJS v4 requires calling `Culqi.validationPaymentMethods()` before showing payment options.** This async validation step must complete before `token.generate()` or `yape.generate()` will work — missing this causes silent failures.

7. **`react-culqi` npm package is React web only** — it uses DOM-specific APIs (`openCulqi` renders a browser popup). It will not work in React Native. The manual should explicitly warn against using it.

8. **Expo SDK 53 is mentioned in the manual, but Expo has already moved through SDK 54 and SDK 55 is imminent.** React 19 version mismatch bugs have been reported in the Expo ecosystem that could break builds.

9. **The `x-culqi-tracking-id` response header** should be logged on every API call — it's the primary identifier Culqi support uses to investigate issues.

10. **Merchant authentication error `"Tu código de comercio no está habilitado"` can occur** when trying to create tokens server-side without first contacting Culqi support to enable direct API token access (separate from PCI DSS compliance).

---

## Outdated Steps (needs update)

1. **Section 6 (Webhook Setup & Verification)** — If the manual documents HMAC verification, this is likely incorrect. No evidence of Culqi supporting HMAC webhook signatures was found. The webhook setup is done via CulqiPanel UI, selecting specific events (e.g., `order.status.changed` for PagoEfectivo). Verification must use alternative methods.

2. **Section 7 (React Native / Expo Integration)** — If the manual references `react-culqi` or any direct React Native Culqi SDK, this needs updating. The only viable path is WebView + CulqiJS v4. Also the 3DS flow adds complexity to the WebView approach that should be documented.

3. **Expo SDK 53 reference** — May need updating depending on when the team upgrades. SDK 55 (with RN 0.83) was projected for January 2026. Watch for React version mismatch issues if upgrading React 19 for security patches.

4. **Section 5 (Recurring Subscriptions)** — The `culqi-node` wrapper does support plan/subscription objects, but the manual should note that recurring charges on Yape are not supported (Yape requires a fresh OTP for each transaction — no saved payment method concept).

5. **Section 9 (Pricing Reference - Centimos)** — Should explicitly note that the `amount` field is in **céntimos** (1/100 of a Sol), so S/100.00 = `10000`. The `culqi-node` examples show `amount: '10000'` as a string. Confirm whether the API accepts string or integer (the Go/PHP SDKs show integer usage).

---

## Key URLs

| Resource | URL |
|---|---|
| **Culqi API Reference (official)** | https://apidocs.culqi.com/ |
| **Culqi Docs — Yape Tokens** | https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens-yape/ |
| **Culqi Docs — Card Tokens** | https://docs.culqi.com/es/documentacion/pagos-online/cargo-unico/tokens/ |
| **Culqi Docs — RSA Encryption** | https://docs.culqi.com/es/documentacion/pagos-online/llaves_rsa/ |
| **Culqi Docs — Webhooks** | https://docs.culqi.com/es/documentacion/pagos-online/webhooks/ |
| **Culqi Docs — CulqiJS v4** | https://docs.culqi.com/es/documentacion/culqi-js/v4/culqi-js/ |
| **Culqi Docs — 3DS Library** | https://docs.culqi.com/es/documentacion/culqi-3ds/v1/uso-libreria/ |
| **Culqi Docs — PagoEfectivo Orders** | https://docs.culqi.com/es/documentacion/pagos-online/ordenes-de-pago/pago-efectivo/ |
| **`culqi-node` npm (community)** | https://www.npmjs.com/package/culqi-node |
| **`culqi-node` GitHub (community)** | https://github.com/giwiro/culqi-node |
| **Culqi ReactJS Demo (Checkout v4)** | https://github.com/culqi/culqi-reactjs-demo-jsv4 |
| **Culqi API v2 error codes (mirror)** | https://github.com/heroseven/api-docs |
| **`react-culqi` (React web only)** | https://github.com/klujanrosas/react-culqi |
| **Yape daily limits FAQ** | https://www.yape.com.pe/preguntas-frecuentes/crear-tu-cuenta-yape/25--cual-es-el-monto-maximo-de-envio-y-recepcion-de-dinero-si-me-registre-con-mi-tarjeta-de-debito-bcp |
| **Expo/RN 0.83 (SDK 55) blog** | https://reactnative.dev/blog/2025/12/10/react-native-0.83 |
| **Expo React 19 version mismatch bug** | https://github.com/expo/expo/issues/41397 |
# 🎤 Whisper Voice Input - Quick Start

Integración rápida de entrada de voz usando tu API de Whisper personalizada.

## ⚡ Inicio Rápido (3 pasos)

### 1️⃣ Configurar
```
Settings → Whisper → Ingresa tu API URL → Save
```

### 2️⃣ Grabar
```
Haz clic en 🎙️ en el chat → Habla → Haz clic en ✅
```

### 3️⃣ ¡Listo!
```
El texto aparece automáticamente en el input
```

---

## 📋 Configuración Mínima

| Campo | Valor |
|-------|-------|
| **API URL** | `https://whisper.contextcompany.com.co/asr` |
| **Task** | `transcribe` (o `translate`) |
| **Language** | `auto` (detección automática) |
| **Output** | `txt` (texto plano) |

> **Nota**: Este servidor no requiere autenticación (API Key).

---

## 🎯 Uso

1. Haz clic en el icono de micrófono 🎙️ en el chat
2. Habla tu mensaje
3. Haz clic en ✅ para transcribir
4. Edita si es necesario y envía

---

## 🔧 Archivos Agregados

```
web-app/src/
├── hooks/useAudioRecorder.ts          # Grabación de audio
├── services/whisper/whisper.ts         # Cliente API
├── containers/MicrophoneButton.tsx     # UI del botón
├── routes/settings/whisper.tsx         # Página de config
└── containers/ChatInput.tsx            # Integrado (modificado)
```

---

## 🔑 Características

- ✅ Grabación desde navegador
- ✅ Transcripción en tiempo real
- ✅ Multi-idioma
- ✅ Controles (pausar/reanudar/cancelar)
- ✅ 100% privado (tu propia API)

---

## ⚙️ Personalizar tu API

Esta integración usa **ahmetoner/whisper-asr-webservice**. Si tu API usa formato diferente, edita:

**`web-app/src/services/whisper/whisper.ts`**

```typescript
// Endpoint /asr con query parameters
const params = new URLSearchParams()
params.append('task', config.task || 'transcribe')
params.append('output', config.output || 'txt')

// Campo del formulario es 'audio_file'
formData.append('audio_file', audioFile)

// URL con parámetros
const url = `${config.apiUrl}?${params.toString()}`
```

---

## 🆘 Problemas Comunes

| Problema | Solución |
|----------|----------|
| Micrófono no detectado | Verifica permisos del navegador |
| Error de API | Confirma URL del servidor |
| Sin transcripción | Verifica volumen y duración (>1 seg) |
| Texto incorrecto | Especifica idioma en config |

---

## 📖 Documentación Completa

Ver `WHISPER_INTEGRATION.md` para guía detallada.

---

## 🎉 ¡Eso es todo!

Ahora tienes entrada de voz completamente funcional en Jan usando tu propia API de Whisper.

**Prueba**: Settings → Whisper → Test Connection

# 🎤 Whisper Voice Input - Quick Start

Integración rápida de entrada de voz usando tu API de Whisper personalizada.

## ⚡ Inicio Rápido (3 pasos)

### 1️⃣ Configurar
```
Settings → Whisper → Ingresa tu API URL y API Key → Save
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
| **API URL** | `https://whisper.contextcompany.com.co/v1/audio/transcriptions` |
| **API Key** | Tu clave personal |
| **Model** | `whisper-1` (opcional) |
| **Language** | `auto` (opcional) |

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

Si tu API usa formato diferente, edita:

**`web-app/src/services/whisper/whisper.ts`**

```typescript
// Cambia según tu endpoint
formData.append('file', audioFile)
formData.append('your_custom_param', 'value')

// Ajusta respuesta
return {
  text: data.your_text_field,
  language: data.your_language_field,
}
```

---

## 🆘 Problemas Comunes

| Problema | Solución |
|----------|----------|
| Micrófono no detectado | Verifica permisos del navegador |
| Error de API | Confirma URL y API key |
| Sin transcripción | Verifica volumen y duración (>1 seg) |
| Texto incorrecto | Especifica idioma en config |

---

## 📖 Documentación Completa

Ver `WHISPER_INTEGRATION.md` para guía detallada.

---

## 🎉 ¡Eso es todo!

Ahora tienes entrada de voz completamente funcional en Jan usando tu propia API de Whisper.

**Prueba**: Settings → Whisper → Test Connection

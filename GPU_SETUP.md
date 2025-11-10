# 🎮 Configuración de GPU para Jan

Esta guía te ayudará a configurar Jan para usar tu GPU NVIDIA (como RTX 5090) para aceleración de modelos.

## ⚠️ Problema Común: Jan corriendo en CPU

Si Jan está corriendo lento y no detecta tu GPU, probablemente es porque:
1. Los drivers de NVIDIA no están instalados
2. Estás ejecutando Jan en un contenedor Docker sin acceso a GPU
3. La configuración de dispositivos no está correcta

---

## 🔍 Diagnóstico Rápido

### Verifica que tu GPU es visible

```bash
nvidia-smi
```

**Deberías ver**:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 545.29.06    Driver Version: 545.29.06    CUDA Version: 12.3     |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|                               |                      |               MIG M. |
|===============================+======================+======================|
|   0  NVIDIA GeForce ...  Off  | 00000000:01:00.0  On |                  N/A |
| 30%   45C    P8    25W / 450W |    500MiB / 24576MiB |      0%      Default |
...
```

Si el comando falla o no muestra tu GPU, **instala los drivers primero**.

---

## 🛠️ Instalación de Drivers NVIDIA

### Ubuntu/Debian

```bash
# 1. Agregar repositorio de NVIDIA (si es necesario)
sudo add-apt-repository ppa:graphics-drivers/ppa
sudo apt update

# 2. Ver drivers disponibles
ubuntu-drivers devices

# 3. Instalar driver recomendado
sudo ubuntu-drivers autoinstall
# O instalar versión específica
sudo apt install nvidia-driver-545  # Ajusta el número de versión

# 4. Reiniciar
sudo reboot

# 5. Verificar instalación
nvidia-smi
```

### Requisitos de Driver para CUDA

| GPU | Compute Capability | Driver Mínimo | CUDA Recomendado |
|-----|-------------------|---------------|------------------|
| RTX 4090 | 8.9 | 520+ | CUDA 12.0+ |
| RTX 5090 | 9.0+ | 550+ | CUDA 12.5+ |
| RTX 3090 | 8.6 | 450+ | CUDA 11.7+ |

---

## 🐳 Si estás usando Docker

Jan en Docker **NO tendrá acceso a GPU por defecto**. Necesitas:

### Opción 1: Ejecutar Jan fuera de Docker (RECOMENDADO)

Para desarrollo y uso general, ejecuta Jan directamente en tu sistema host:

```bash
# En tu máquina host (fuera de Docker)
cd ~/jan02
yarn install
yarn dev:tauri
```

### Opción 2: Docker con GPU Access

Si necesitas usar Docker, instala nvidia-container-toolkit:

```bash
# 1. Instalar NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# 2. Ejecutar contenedor con GPU
docker run --gpus all -it tu-imagen

# 3. Verificar GPU en contenedor
nvidia-smi  # Dentro del contenedor
```

---

## ⚙️ Configuración de Jan para GPU

Una vez que tu GPU es visible (`nvidia-smi` funciona), Jan debería detectarla automáticamente.

### Verificar detección de GPU

1. **Abre Jan**
2. Ve a **Settings** → **Advanced** → **System Information**
3. Busca la sección **GPUs**
4. Deberías ver tu GPU listada con:
   - Nombre (ej: "NVIDIA GeForce RTX 5090")
   - VRAM (ej: "24 GB")
   - Compute Capability (ej: "9.0")

### Configurar dispositivos para offload

1. **Settings** → **Extensions** → **LlamaCpp Extension** → **Settings**
2. Busca **"Devices for Offload"**
3. Configura: `CUDA0` (o `CUDA0,CUDA1` si tienes múltiples GPUs)
4. Guarda cambios

### Verificar backend seleccionado

Jan selecciona automáticamente el mejor backend:

**Prioridad de backends**:
1. `cuda-cu12.0` ← Mejor para RTX 4090/5090 (requiere driver 525.60.13+)
2. `cuda-cu11.7` ← Para drivers más antiguos (450.80.02+)
3. `vulkan` ← Fallback genérico (GPU con 6GB+)
4. `cpu` ← Más lento, sin GPU

**Verificar en UI**:
- Settings → Advanced → Model Configuration
- Debería mostrar: "Backend: cuda-cu12.0" o similar

---

## 🧪 Probar que GPU funciona

### Método 1: Ver uso de GPU mientras cargas un modelo

```bash
# Terminal 1: Monitorear GPU
watch -n 1 nvidia-smi

# Terminal 2: Abrir Jan y cargar un modelo
# Deberías ver uso de memoria GPU aumentar
```

### Método 2: Logs de Jan

Los logs mostrarán algo como:
```
[INFO] CUDA device 0: NVIDIA GeForce RTX 5090 (24576 MB)
[INFO] Using backend: cuda-cu12.0
[INFO] GPU layers: 40/40
```

---

## 🐛 Solución de Problemas

### GPU no aparece en Jan

**Problema**: Jan muestra 0 GPUs o no lista tu NVIDIA GPU

**Soluciones**:
1. Verifica que `nvidia-smi` funciona
2. Verifica que `libnvidia-ml.so.1` existe:
   ```bash
   ldconfig -p | grep nvidia-ml
   ```
3. Si falta, reinstala drivers NVIDIA
4. Reinicia Jan completamente

### Jan sigue usando CPU

**Problema**: GPU detectada pero modelos usan CPU

**Soluciones**:
1. Configura "Devices for Offload" a `CUDA0`
2. Verifica que tienes suficiente VRAM
3. Descarga el modelo compatible con CUDA:
   - Settings → Models → Download model con etiqueta "CUDA"
4. Verifica que GPU layers > 0 en configuración de modelo

### Error: "CUDA not available"

**Problema**: Mensaje de error sobre CUDA no disponible

**Soluciones**:
1. Instala CUDA toolkit (opcional, drivers ya incluyen runtime):
   ```bash
   sudo apt install nvidia-cuda-toolkit
   ```
2. Verifica versión de driver soporta CUDA 12:
   ```bash
   nvidia-smi  # Busca "CUDA Version: XX.X"
   ```

### Vulkan en lugar de CUDA

**Problema**: Jan usa Vulkan en lugar de CUDA (más lento)

**Soluciones**:
1. Actualiza drivers NVIDIA a versión más reciente
2. Verifica que driver soporta CUDA 12 (driver 525+)
3. Fuerza backend CUDA en configuración de extensión

---

## 📊 Rendimiento Esperado

Con GPU correctamente configurada:

| Modelo | Tamaño | RTX 5090 (24GB) | RTX 4090 (24GB) | CPU Only |
|--------|--------|-----------------|-----------------|----------|
| Llama 3 8B | 4.7GB | ~80 tokens/s | ~70 tokens/s | ~5 tokens/s |
| Llama 3 70B | 40GB Q4 | ~25 tokens/s | ~20 tokens/s | ~1 token/s |
| Mistral 7B | 4.1GB | ~90 tokens/s | ~75 tokens/s | ~6 tokens/s |

Si ves velocidades cercanas a "CPU Only", tu GPU no está siendo usada.

---

## 🔗 Referencias

- [NVIDIA Driver Downloads](https://www.nvidia.com/download/index.aspx)
- [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
- [Jan Documentation](https://jan.ai/docs)
- [NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)

---

## 💡 Tips

- **RTX 5090**: Usa driver 550+ para mejor soporte
- **Multi-GPU**: Configura "Devices for Offload" a `CUDA0,CUDA1`
- **Monitoreo**: Usa `nvidia-smi -l 1` para ver uso en tiempo real
- **VRAM**: Asegúrate que el modelo cabe en tu VRAM (Q4 quantization ahorra memoria)

---

**¿Sigues teniendo problemas?** Abre un issue en GitHub con:
1. Output de `nvidia-smi`
2. Logs de Jan (Help → Show Logs)
3. Tu configuración de dispositivos
4. Sistema operativo y versión

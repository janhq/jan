# 📋 Instrucciones para Crear el Release v0.6.600

## 🎯 Opción 1: Usando GitHub Web Interface (Recomendado)

### Pasos:

1. **Ir a la página de Releases**
   - Abre tu navegador y ve a: https://github.com/Danielsalamank/jan02/releases/new

2. **Configurar el Tag**
   - En "Choose a tag" escribe: `v0.6.600`
   - Haz clic en "Create new tag: v0.6.600 on publish"

3. **Seleccionar Target Branch**
   - Target: `claude/add-spanish-language-011CUoMCCPrvSfShzYwnntZi`

4. **Título del Release**
   ```
   Release v0.6.600 - Spanish Language Support 🌍
   ```

5. **Descripción del Release**
   - Copia y pega el contenido completo del archivo: `RELEASE_NOTES_v0.6.600.md`
   - O usa el botón "Generate release notes" y luego edita

6. **Opciones adicionales**
   - ✅ Marca "Set as a pre-release" si es una versión de prueba
   - ✅ O deja sin marcar para una versión estable

7. **Publicar**
   - Opción A: Haz clic en **"Publish release"** para publicar inmediatamente
   - Opción B: Haz clic en **"Save draft"** para revisarlo después

8. **GitHub Actions se ejecutará automáticamente** ⚡
   - Compilará para Windows, macOS y Linux
   - Tardará aproximadamente 30-40 minutos
   - Los instaladores se subirán automáticamente al release

---

## 🎯 Opción 2: Usando GitHub CLI (gh)

Si tienes GitHub CLI instalado en tu máquina local:

### 1. Asegúrate de tener gh CLI instalado:
```bash
# macOS
brew install gh

# Windows
winget install --id GitHub.cli

# Linux
sudo apt install gh
```

### 2. Autentícate (si aún no lo has hecho):
```bash
gh auth login
```

### 3. Ejecuta el script:
```bash
cd /home/user/jan02
./create-release.sh
```

El script automáticamente:
- ✅ Creará el tag v0.6.600
- ✅ Lo subirá a GitHub
- ✅ Creará un draft release
- ✅ Incluirá las notas de versión

---

## 🎯 Opción 3: Manual con Git + Web

### Paso 1: Crear el tag localmente
```bash
cd /home/user/jan02
git tag -a v0.6.600 -m "Release v0.6.600 - Spanish Language Support"
```

### Paso 2: Subir el tag a GitHub
```bash
git push origin v0.6.600
```

⚠️ **Nota**: Si obtienes error 403, pide al propietario del repositorio que cree el tag y release.

### Paso 3: Ir a GitHub y crear el Release
- Sigue los pasos de la **Opción 1** anterior
- El tag v0.6.600 ya existirá, solo selecciónalo

---

## ✅ Después de Crear el Release

### 1. Monitorear GitHub Actions
- Ve a: https://github.com/Danielsalamank/jan02/actions
- Verás el workflow "Tauri Builder - Tag" ejecutándose
- Espera a que todos los builds terminen (verde ✅)

### 2. Verificar Artefactos
Una vez completado, tu release tendrá:
- 🪟 `Jan_0.6.600_x64-setup.exe` (Windows installer)
- 🪟 `Jan_0.6.600_x64_en-US.msi` (Windows MSI)
- 🍎 `Jan_0.6.600_universal.dmg` (macOS Universal)
- 🐧 `Jan_0.6.600_amd64.AppImage` (Linux AppImage)
- 🐧 `Jan_0.6.600_amd64.deb` (Linux Debian)

### 3. Publicar el Release
Si creaste un draft:
- Ve a https://github.com/Danielsalamank/jan02/releases
- Edita el draft release
- Haz clic en "Publish release"

---

## 🎊 ¡Listo!

Tu release con soporte de idioma español estará disponible para descargar en:
https://github.com/Danielsalamank/jan02/releases/tag/v0.6.600

---

## 🆘 Solución de Problemas

### Error 403 al hacer push del tag
- **Causa**: No tienes permisos para crear tags directamente
- **Solución**: Usa la Opción 1 (GitHub Web Interface)

### GitHub Actions no se ejecuta
- **Verifica**: Que el tag comience con 'v' (ejemplo: v0.6.600)
- **Verifica**: Que hayas publicado el release (no dejarlo como draft)
- **Verifica**: En Settings → Actions → General que workflows estén habilitados

### Los builds fallan
- **Revisa**: Los logs en la pestaña Actions
- **Verifica**: Que todos los archivos de traducción estén en su lugar
- **Verifica**: Que las versiones en `tauri.conf.json` y `package.json` coincidan

---

## 📞 Necesitas Ayuda?

Si tienes problemas, revisa:
- [Jan Documentation](https://jan.ai/docs)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Tauri Build Documentation](https://tauri.app/v1/guides/building/)

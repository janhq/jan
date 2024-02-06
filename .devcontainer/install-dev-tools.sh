# Add i386 architecture for cross-compilation
dpkg --add-architecture i386

# Install dependencies for building Jan, make sure to use i386
apt update -y
export DEBIAN_FRONTEND=noninteractive
# libc6 is required by qemu-i386 on some architectures
apt -y install --no-install-recommends libc6:i386

apt autoremove -y
apt clean -y
rm -rf /var/lib/apt/lists/*

# Setup YARN later for mounted project using corepack
corepack enable

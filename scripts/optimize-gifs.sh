#!/bin/bash

# Create backup directory if it doesn't exist
BACKUP_DIR="docs/public/assets/images/changelog/originals"
mkdir -p "$BACKUP_DIR"

# Process each GIF in the changelog directory
for gif in docs/public/assets/images/changelog/*.gif; do
    if [ -f "$gif" ]; then
        # Get filename without path
        filename=$(basename "$gif")
        
        # Create backup
        cp "$gif" "$BACKUP_DIR/$filename"
        
        # Optimize GIF
        # -O3: highest optimization level
        # --lossy=80: allow some quality loss for better compression
        # --colors 256: reduce color palette to 256 colors
        gifsicle -O3 --lossy=80 --colors 256 "$gif" -o "${gif%.gif}_optimized.gif"
        
        # Get file sizes
        original_size=$(stat -f%z "$gif")
        optimized_size=$(stat -f%z "${gif%.gif}_optimized.gif")
        
        # Calculate size reduction percentage
        reduction=$(echo "scale=2; (($original_size - $optimized_size) / $original_size) * 100" | bc)
        
        echo "Processed $filename:"
        echo "Original size: $(($original_size/1024))KB"
        echo "Optimized size: $(($optimized_size/1024))KB"
        echo "Size reduction: ${reduction}%"
        echo "-------------------"
    fi
done

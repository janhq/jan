import hashlib
import base64
import sys

def hash_file(file_path):
    # Create a SHA-512 hash object
    sha512 = hashlib.sha512()

    # Read and update the hash object with the content of the file
   try:
        # Read and update the hash object with the content of the file
        with open(file_path, 'rb') as f:
            while True:
                data = f.read(1024 * 1024)  # Read in 1 MB chunks
                if not data:
                    break
                sha512.update(data)
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
        sys.exit(1)
    except PermissionError:
        print(f"Error: Permission denied when accessing '{file_path}'.")
        sys.exit(1)
    except IOError as e:
        print(f"IO error while reading '{file_path}': {e}")
        sys.exit(1)

    # Obtain the hash result and encode it in base64
    hash_base64 = base64.b64encode(sha512.digest()).decode('utf-8')
    return hash_base64

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 script.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    hash_base64_output = hash_file(file_path)
    print(hash_base64_output)

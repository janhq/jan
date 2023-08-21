### Ref

<https://github.com/FiloSottile/mkcert>

### Copy CA

```
cp $(mkcert -CAROOT)/rootCA.pem .

cp $(mkcert -CAROOT)/rootCA-key.pem .
```

### Create certificate

```
$ mkcert jan.local "*.jan.local"
```
# Configuring Keycloak theme
Jan comes with a default theme for Keycloak. Extended from [Keywind](https://github.com/lukin/keywind)

## Select keywind as theme
1. Navigate to http://localhost:8088/admin
2. Sign in with below credentials
```
username: admin
password: admin
```
3. Select `hasura` from the top left dropdown box
![Screenshot 2023-09-06 at 15 10 53](https://github.com/janhq/jan/assets/10397206/5e3cf99b-7cd6-43ff-a003-e66aedd8c850)

4. Select `Realm settings` on left navigation bar and open tab `Themes` 
![Screenshot 2023-09-06 at 15 14 05](https://github.com/janhq/jan/assets/10397206/3256b5c4-e3e7-48ef-9c5e-f720b5beeaa8)

5. On `Login theme` open the drop down box and select `keywind` 
![Screenshot 2023-09-06 at 15 15 28](https://github.com/janhq/jan/assets/10397206/c52ba743-d978-4963-9311-cf84b4bb5389)

6. Save

**That's it!**

Open your web browser and navigate to `http://localhost:3000` to access Jan web application. Proceed to `Login` on the top right.

You should expect the theme as below. If it's does not, try to clear the cache from your browser.

![Screenshot 2023-09-06 at 15 29 09](https://github.com/janhq/jan/assets/10397206/a80a32e7-633f-4109-90fa-ec223c9d3b17)

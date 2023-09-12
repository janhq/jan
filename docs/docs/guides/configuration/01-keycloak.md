---
title: Keycloak Configuration Guide
---

## 1. Introduction to Keycloak

[Keycloak](https://www.keycloak.org/) is an open-source Identity and Access Management solution aimed at modern applications and services. It makes it easy to secure applications and services with minimal code. [Keycloak](https://www.keycloak.org/) is developed and maintained by Red Hat.

## 2. Purpose of Using Keycloak in Jan

Jan uses [Keycloak](https://www.keycloak.org/) as an Identity Provider (IDP). Users can either create their own user accounts within a Keycloak realm or integrate with other IDPs for authentication.

## 3. Configuring Keycloak: Step-by-Step Guide

### Keycloak installation

If you are following the [Quick Start Guide](../quickstart.md) then keycloak installation is included in our `docker-compose.develop.yml` file. Just remember to modify the Keycloak admin credential in `.env` file

```SHELL
KEYCLOAK_VERSION=22.0.0
KEYCLOAK_ADMIN=*****           # Set your own admin
KEYCLOAK_ADMIN_PASSWORD=*****  # Set your own admin password

# Inference
## LLM
LLM_MODEL_URL=https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGML/resolve/main/llama-2-7b-chat.ggmlv3.q4_1.bin
LLM_MODEL_FILE=llama-2-7b-chat.ggmlv3.q4_1.bin
```

In case you want to install Keycloak by yourself, you can follow one of the instructions below:
- [Getting started with keycloak on docker](https://www.keycloak.org/getting-started/getting-started-docker)
- [Getting started with keycloak on kubernetes](https://www.keycloak.org/getting-started/getting-started-kube)
- [Getting started with keycloak on bare metal](https://www.keycloak.org/getting-started/getting-started-zip)
- [Deploy keycloak using helm chart](https://bitnami.com/stack/keycloak/helm)

### Creating New Realm

1. Log in to the Keycloak Admin Console.
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console.png)
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_login.png)

2. In the top-left corner, click on "Select realm" and then click on "Create realm."

  ![Add Realm](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_realm.png)

3. Give your realm a name and click on "Create."

  ![Add Realm](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_realm_name.png)

### Adding a Client ID

1. In the left sidebar, click on "Clients.", then Click on "Create client".
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_1.png)

2. Fill in the "Client ID" and other optional settings. Click "Save."
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_2.png)

3. Then click "Next"
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_3.png)

4. Fill in the web-client public url then click "Save"
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_4.png)

5. Save the client credential for web-client configuration
  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_5.png)
### Keycloak User Roles

In Keycloak, you can create two types of roles:

Realm roles - all the clients share them
Client roles - they are available only to that client for which it was created
In this case, you will create a “Client role”, so it’s only available to your Hasura application.

Navigate to the “Clients” page and click on your “Hasura” client. After that, go to the “Roles” page, as shown in the image below.

  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_role_1.png)

Click the “Create Role” button.

On the next page, choose user as the role name. Regarding the role description, you can leave it empty or add something.

  ![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_client_role_2.png)

### Add User in Keycloak and assign Role

Now you have the role, but not a user. That means you need to create a user and assign the role.

![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_1.png)

Save the user after adding a username (other details are optional).
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_2.png)

Now you need to set up a password for your user, which you can do on the credentials page. You can see the “Credentials” tab at the top of the page.
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_3.png)

Choose a password for your user and confirm it.
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_4.png)


Go to the “Role Mappings” page and select your client in the “Client Roles” field. Then choose the `user` role from the “Available Roles” and add it by clicking “Assign”.
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_5.png)
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_6.png)
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_create_user_7.png)


### Create Mappers for Custom JWT Claims
Hasura decodes and verifies the JWT token returned by the auth server - Keycloak in this case.

Each token will contain some data about the request, such as:
- the roles that are allowed to make the request
- the user id

and so on. This way, Hasura can enforce the necessary authorization rules.

These are the `x-hasura-*` values you need to pass in the token:
- `x-hasura-default-role`
- `x-hasura-allowed-roles`
- `x-hasura-user-id`

Keycloak enables you to do that with the “Mappers” feature.
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_1.png)
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_2.png)

The first Protocol Mapper is for the allowed roles. Add the following values:
- Name: `x-hasura-default-role`
- Mapper Type: Hardcoded claim
- Claim value: user
- Token Claim Name: `https://hasura\.io/jwt/claims.x-hasura-default-role`
- Claim JSON Type: String
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_3.png)
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_4.png)


The next Protocol Mapper is for the default role. Add the following values:
- Name: `x-hasura-allowed-roles`
- Mapper Type: User Client Role
- Claim value: your client
- Multivalued: ON
- Token Claim Name: `https://hasura\.io/jwt/claims.x-hasura-allowed-roles`
- Claim JSON Type: String
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_5.png)
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_6.png)

The last Protocol Mapper is for the user id. Add the following values:
- Name: `x-hasura-user-id`
- Mapper Type: User Property
- Property: id
- Token Claim Name: https://hasura\.io/jwt/claims.x-hasura-user-id
- Claim JSON Type: String
![](../../../static/img/docs_guides_configuration_keycloak_admin_console_client_create_mapper_7.png)


---

For more advanced configurations, consult the [official Keycloak documentation](https://www.keycloak.org/documentation.html).

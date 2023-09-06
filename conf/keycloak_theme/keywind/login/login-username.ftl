<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/checkbox.ftl" as checkbox>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>
<#import "components/atoms/link.ftl" as link>
<#import "components/molecules/identity-provider.ftl" as identityProvider>
<#import "features/labels/username.ftl" as usernameLabel>

<#assign usernameLabel><@usernameLabel.kw /></#assign>

<@layout.registrationLayout
  displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??
  displayMessage=!messagesPerField.existsError("username")
  ;
  section
>
  <#if section="header">
    ${msg("loginAccountTitle")}
  <#elseif section="form">
    <#if realm.password>
      <@form.kw
        action=url.loginAction
        method="post"
        onsubmit="login.disabled = true; return true;"
      >
        <#if !usernameHidden??>
          <@input.kw
            autocomplete=realm.loginWithEmailAllowed?string("email", "username")
            autofocus=true
            disabled=usernameEditDisabled??
            invalid=messagesPerField.existsError("username")
            label=usernameLabel
            message=kcSanitize(messagesPerField.get("username"))?no_esc
            name="username"
            type="text"
            value=(login.username)!''
          />
        </#if>
        <#if realm.rememberMe && !usernameHidden??>
          <div class="flex items-center justify-between">
            <@checkbox.kw
              checked=login.rememberMe??
              label=msg("rememberMe")
              name="rememberMe"
            />
          </div>
        </#if>
        <@buttonGroup.kw>
          <@button.kw color="primary" name="login" type="submit">
            ${msg("doLogIn")}
          </@button.kw>
        </@buttonGroup.kw>
      </@form.kw>
    </#if>
  <#elseif section="info">
    <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
      <div class="text-center">
        ${msg("noAccount")}
        <@link.kw color="primary" href=url.registrationUrl>
          ${msg("doRegister")}
        </@link.kw>
      </div>
    </#if>
  <#elseif section="socialProviders">
    <#if realm.password && social.providers??>
      <@identityProvider.kw providers=social.providers />
    </#if>
  </#if>
</@layout.registrationLayout>

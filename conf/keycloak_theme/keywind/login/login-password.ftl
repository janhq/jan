<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>
<#import "components/atoms/link.ftl" as link>

<@layout.registrationLayout displayMessage=!messagesPerField.existsError("password"); section>
  <#if section="header">
    ${msg("doLogIn")}
  <#elseif section="form">
    <@form.kw
      action=url.loginAction
      method="post"
      onsubmit="login.disabled = true; return true;"
    >
      <@input.kw
        autofocus=true
        invalid=messagesPerField.existsError("password")
        label=msg("password")
        message=kcSanitize(messagesPerField.get("password"))?no_esc
        name="password"
        type="password"
      />
      <#if realm.resetPasswordAllowed>
        <div class="flex items-center justify-between">
          <@link.kw color="primary" href=url.loginResetCredentialsUrl size="small">
            ${msg("doForgotPassword")}
          </@link.kw>
        </div>
      </#if>
      <@buttonGroup.kw>
        <@button.kw color="primary" name="login" type="submit">
          ${msg("doLogIn")}
        </@button.kw>
      </@buttonGroup.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>
<#import "components/atoms/radio.ftl" as radio>
<#import "features/labels/totp.ftl" as totpLabel>

<#assign totpLabel><@totpLabel.kw /></#assign>

<@layout.registrationLayout
  displayMessage=!messagesPerField.existsError("totp")
  ;
  section
>
  <#if section="header">
    ${msg("doLogIn")}
  <#elseif section="form">
    <@form.kw action=url.loginAction method="post">
      <#if otpLogin.userOtpCredentials?size gt 1>
        <div class="flex items-center space-x-4">
          <#list otpLogin.userOtpCredentials as otpCredential>
            <@radio.kw
              checked=(otpCredential.id == otpLogin.selectedCredentialId)
              id="kw-otp-credential-${otpCredential?index}"
              label=otpCredential.userLabel
              name="selectedCredentialId"
              tabindex=otpCredential?index
              value=otpCredential.id
            />
          </#list>
        </div>
      </#if>
      <@input.kw
        autocomplete="off"
        autofocus=true
        invalid=messagesPerField.existsError("totp")
        label=totpLabel
        message=kcSanitize(messagesPerField.get("totp"))
        name="otp"
        type="text"
      />
      <@buttonGroup.kw>
        <@button.kw color="primary" name="submitAction" type="submit">
          ${msg("doLogIn")}
        </@button.kw>
      </@buttonGroup.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

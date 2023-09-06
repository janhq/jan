<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>
<#import "components/atoms/link.ftl" as link>
<#import "features/labels/totp.ftl" as totpLabel>
<#import "features/labels/totp-device.ftl" as totpDeviceLabel>

<#assign totpLabel><@totpLabel.kw /></#assign>
<#assign totpDeviceLabel><@totpDeviceLabel.kw /></#assign>

<@layout.registrationLayout
  displayMessage=!messagesPerField.existsError("totp", "userLabel")
  displayRequiredFields=false
  ;
  section
>
  <#if section="header">
    ${msg("loginTotpTitle")}
  <#elseif section="form">
    <ol class="list-decimal pl-4 space-y-2">
      <li class="space-y-2">
        <p>${msg("loginTotpStep1")}</p>
        <ul class="list-disc pl-4">
          <#list totp.supportedApplications as app>
            <li>${msg(app)}</li>
          </#list>
        </ul>
      </li>
      <#if mode?? && mode="manual">
        <li>
          <p>${msg("loginTotpManualStep2")}</p>
          <p class="font-medium text-xl">${totp.totpSecretEncoded}</p>
        </li>
        <li>
          <@link.kw color="primary" href=totp.qrUrl>
            ${msg("loginTotpScanBarcode")}
          </@link.kw>
        </li>
        <li class="space-y-2">
          <p>${msg("loginTotpManualStep3")}</p>
          <ul class="list-disc pl-4">
            <li>${msg("loginTotpType")}: ${msg("loginTotp." + totp.policy.type)}</li>
            <li>${msg("loginTotpAlgorithm")}: ${totp.policy.getAlgorithmKey()}</li>
            <li>${msg("loginTotpDigits")}: ${totp.policy.digits}</li>
            <#if totp.policy.type="totp">
              <li>${msg("loginTotpInterval")}: ${totp.policy.period}</li>
            <#elseif totp.policy.type="hotp">
              <li>${msg("loginTotpCounter")}: ${totp.policy.initialCounter}</li>
            </#if>
          </ul>
        </li>
      <#else>
        <li>
          <p>${msg("loginTotpStep2")}</p>
          <img
            alt="Figure: Barcode"
            class="mx-auto"
            src="data:image/png;base64, ${totp.totpSecretQrCode}"
          >
          <@link.kw color="primary" href=totp.manualUrl>
            ${msg("loginTotpUnableToScan")}
          </@link.kw>
        </li>
      </#if>
      <li>${msg("loginTotpStep3")}</li>
      <li>${msg("loginTotpStep3DeviceName")}</li>
    </ol>
    <@form.kw action=url.loginAction method="post">
      <input name="totpSecret" type="hidden" value="${totp.totpSecret}">
      <#if mode??>
        <input name="mode" type="hidden" value="${mode}">
      </#if>
      <@input.kw
        autocomplete="off"
        autofocus=true
        invalid=messagesPerField.existsError("totp")
        label=totpLabel
        message=kcSanitize(messagesPerField.get("totp"))
        name="totp"
        required=false
        type="text"
      />
      <@input.kw
        autocomplete="off"
        invalid=messagesPerField.existsError("userLabel")
        label=totpDeviceLabel
        message=kcSanitize(messagesPerField.get("userLabel"))
        name="userLabel"
        required=false
        type="text"
      />
      <@buttonGroup.kw>
        <#if isAppInitiatedAction??>
          <@button.kw color="primary" type="submit">
            ${msg("doSubmit")}
          </@button.kw>
          <@button.kw color="secondary" name="cancel-aia" type="submit" value="true">
            ${msg("doCancel")}
          </@button.kw>
        <#else>
          <@button.kw color="primary" type="submit">
            ${msg("doSubmit")}
          </@button.kw>
        </#if>
      </@buttonGroup.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

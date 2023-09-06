<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>

<@layout.registrationLayout script="dist/webAuthnRegister.js"; section>
  <#if section="title">
    title
  <#elseif section="header">
    ${kcSanitize(msg("webauthn-registration-title"))?no_esc}
  <#elseif section="form">
    <div x-data="webAuthnRegister">
      <form action="${url.loginAction}" method="post" x-ref="registerForm">
        <input name="attestationObject" type="hidden" x-ref="attestationObjectInput" />
        <input name="authenticatorLabel" type="hidden" x-ref="authenticatorLabelInput" />
        <input name="clientDataJSON" type="hidden" x-ref="clientDataJSONInput" />
        <input name="error" type="hidden" x-ref="errorInput" />
        <input name="publicKeyCredentialId" type="hidden" x-ref="publicKeyCredentialIdInput" />
        <input name="transports" type="hidden" x-ref="transportsInput" />
      </form>
      <@buttonGroup.kw>
        <@button.kw @click="registerSecurityKey" color="primary" type="submit">
          ${msg("doRegister")}
        </@button.kw>
        <#if !isSetRetry?has_content && isAppInitiatedAction?has_content>
          <form action="${url.loginAction}" method="post">
            <@button.kw color="secondary" name="cancel-aia" type="submit" value="true">
              ${msg("doCancel")}
            </@button.kw>
          </form>
        </#if>
      </@buttonGroup.kw>
    </div>
  </#if>
</@layout.registrationLayout>

<script>
  document.addEventListener('alpine:init', () => {
    Alpine.store('webAuthnRegister', {
      attestationConveyancePreference: '${attestationConveyancePreference}',
      authenticatorAttachment: '${authenticatorAttachment}',
      challenge: '${challenge}',
      createTimeout: '${createTimeout}',
      excludeCredentialIds: '${excludeCredentialIds}',
      requireResidentKey: '${requireResidentKey}',
      rpEntityName: '${rpEntityName}',
      rpId: '${rpId}',
      signatureAlgorithms: '${signatureAlgorithms}',
      unsupportedBrowserText: '${msg("webauthn-unsupported-browser-text")?no_esc}',
      userId: '${userid}',
      userVerificationRequirement: '${userVerificationRequirement}',
      username: '${username}',
    })
  })
</script>

<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>

<@layout.registrationLayout displayMessage=true; section>
  <#if section="header">
    ${kcSanitize(msg("webauthn-error-title"))?no_esc}
  <#elseif section="form">
    <div x-data>
      <form action="${url.loginAction}" method="post" x-ref="errorCredentialForm">
        <input name="authenticationExecution" type="hidden" x-ref="executionValueInput" />
        <input name="isSetRetry" type="hidden" x-ref="isSetRetryInput" />
      </form>
      <@buttonGroup.kw>
        <@button.kw
          @click="$refs.executionValueInput.value = '${execution}'; $refs.isSetRetryInput.value = 'retry'; $refs.errorCredentialForm.submit()"
          color="primary"
          name="try-again"
          tabindex="4"
          type="button"
        >
          ${kcSanitize(msg("doTryAgain"))?no_esc}
        </@button.kw>
        <#if isAppInitiatedAction??>
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

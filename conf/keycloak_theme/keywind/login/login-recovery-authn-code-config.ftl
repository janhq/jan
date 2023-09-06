<#import "template.ftl" as layout>
<#import "components/atoms/alert.ftl" as alert>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/checkbox.ftl" as checkbox>
<#import "components/atoms/form.ftl" as form>

<@layout.registrationLayout script="dist/recoveryCodes.js"; section>
  <#if section="header">
    ${msg("recovery-code-config-header")}
  <#elseif section="form">
    <div class="space-y-6" x-data="recoveryCodes">
      <@alert.kw color="warning">
        <div class="space-y-2">
          <h4 class="font-medium">${msg("recovery-code-config-warning-title")}</h4>
          <p>${msg("recovery-code-config-warning-message")}</p>
        </div>
      </@alert.kw>
      <ul class="columns-2 font-mono text-center" x-ref="codeList">
        <#list recoveryAuthnCodesConfigBean.generatedRecoveryAuthnCodesList as code>
          <li>${code[0..3]}-${code[4..7]}-${code[8..]}</li>
        </#list>
      </ul>
      <div class="flex items-stretch space-x-4 mb-4">
        <@button.kw @click="print" color="secondary" size="small" type="button">
          ${msg("recovery-codes-print")}
        </@button.kw>
        <@button.kw @click="download" color="secondary" size="small" type="button">
          ${msg("recovery-codes-download")}
        </@button.kw>
        <@button.kw @click="copy" color="secondary" size="small" type="button">
          ${msg("recovery-codes-copy")}
        </@button.kw>
      </div>
      <@form.kw action=url.loginAction method="post">
        <input
          name="generatedRecoveryAuthnCodes"
          type="hidden"
          value="${recoveryAuthnCodesConfigBean.generatedRecoveryAuthnCodesAsString}"
        />
        <input
          name="generatedAt"
          type="hidden"
          value="${recoveryAuthnCodesConfigBean.generatedAt?c}"
        />
        <input
          name="userLabel"
          type="hidden"
          value="${msg('recovery-codes-label-default')}"
        />
        <@checkbox.kw
          label=msg("recovery-codes-confirmation-message")
          name="kcRecoveryCodesConfirmationCheck"
          required="required"
          x\-ref="confirmationCheck"
        />
        <@buttonGroup.kw>
          <#if isAppInitiatedAction??>
            <@button.kw color="primary" type="submit">
              ${msg("recovery-codes-action-complete")}
            </@button.kw>
            <@button.kw
              @click="$refs.confirmationCheck.required = false"
              color="secondary"
              name="cancel-aia"
              type="submit"
              value="true"
            >
              ${msg("recovery-codes-action-cancel")}
            </@button.kw>
          <#else>
            <@button.kw color="primary" type="submit">
              ${msg("recovery-codes-action-complete")}
            </@button.kw>
          </#if>
        </@buttonGroup.kw>
      </@form.kw>
    </div>
  </#if>
</@layout.registrationLayout>

<script>
  document.addEventListener('alpine:init', () => {
    Alpine.store('recoveryCodes', {
      downloadFileDate: '${msg("recovery-codes-download-file-date")}',
      downloadFileDescription: '${msg("recovery-codes-download-file-description")}',
      downloadFileHeader: '${msg("recovery-codes-download-file-header")}',
      downloadFileName: 'kc-download-recovery-codes',
    })
  })
</script>

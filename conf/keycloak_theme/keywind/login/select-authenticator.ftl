<#import "template.ftl" as layout>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/link.ftl" as link>

<@layout.registrationLayout displayInfo=false; section>
  <#if section="header">
    ${msg("loginChooseAuthenticator")}
  <#elseif section="form">
    <div x-data>
      <@form.kw action=url.loginAction method="post" x\-ref="selectCredentialForm">
        <input name="authenticationExecution" type="hidden" x-ref="authExecInput" />
        <#list auth.authenticationSelections as authenticationSelection>
          <div>
            <@link.kw
              @click="$refs.authExecInput.value = '${authenticationSelection.authExecId}'; $refs.selectCredentialForm.submit()"
              color="primary"
              component="button"
              type="button"
            >
              ${msg("${authenticationSelection.displayName}")}
            </@link.kw>
            <div class="text-sm">${msg("${authenticationSelection.helpText}")}</div>
          </div>
        </#list>
      </@form.kw>
    </div>
  </#if>
</@layout.registrationLayout>

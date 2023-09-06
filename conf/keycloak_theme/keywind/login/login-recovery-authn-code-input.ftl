<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>

<@layout.registrationLayout; section>
  <#if section="header">
    ${msg("auth-recovery-code-header")}
  <#elseif section="form">
    <@form.kw action=url.loginAction method="post">
      <@input.kw
        autocomplete="off"
        autofocus=true
        label=msg("auth-recovery-code-prompt", recoveryAuthnCodesInputBean.codeNumber?c)
        name="recoveryCodeInput"
        type="text"
      />
      <@buttonGroup.kw>
        <@button.kw color="primary" name="login" type="submit">
          ${msg("doLogIn")}
        </@button.kw>
      </@buttonGroup.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

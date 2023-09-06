<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>

<@layout.registrationLayout; section>
  <#if section="header">
    ${msg("pageExpiredTitle")}
  <#elseif section="form">
    <@buttonGroup.kw>
      <@button.kw color="primary" component="a" href=url.loginRestartFlowUrl>
        ${msg("doTryAgain")}
      </@button.kw>
      <@button.kw color="secondary" component="a" href=url.loginAction>
        ${msg("doContinue")}
      </@button.kw>
    </@buttonGroup.kw>
  </#if>
</@layout.registrationLayout>

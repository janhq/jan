<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/link.ftl" as link>

<@layout.registrationLayout; section>
  <#if section="header">
    ${msg("logoutConfirmTitle")}
  <#elseif section="form">
    <p>${msg("logoutConfirmHeader")}</p>
    <@form.kw action=url.logoutConfirmAction method="post">
      <input name="session_code" type="hidden" value="${logoutConfirm.code}">
      <@button.kw color="primary" name="confirmLogout" type="submit" value=msg('doLogout')>
        ${msg("doLogout")}
      </@button.kw>
    </@form.kw>
    <#if !logoutConfirm.skipLink>
      <#if (client.baseUrl)?has_content>
        <@link.kw color="secondary" href=client.baseUrl size="small">
          ${kcSanitize(msg("backToApplication"))?no_esc}
        </@link.kw>
      </#if>
    </#if>
  </#if>
</@layout.registrationLayout>

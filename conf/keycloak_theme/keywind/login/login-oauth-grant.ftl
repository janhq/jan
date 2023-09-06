<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/form.ftl" as form>

<@layout.registrationLayout; section>
  <#if section="header">
    <#if client.attributes.logoUri??>
      <img class="mb-4 mx-auto" src="${client.attributes.logoUri}"/>
    </#if>
    <p>
      <#if client.name?has_content>
        ${msg("oauthGrantTitle", advancedMsg(client.name))}
      <#else>
        ${msg("oauthGrantTitle", client.clientId)}
      </#if>
    </p>
  <#elseif section="form">
    <h3>${msg("oauthGrantRequest")}</h3>
    <ul class="list-disc pl-4">
      <#if oauth.clientScopesRequested??>
        <#list oauth.clientScopesRequested as clientScope>
          <li>
            <#if !clientScope.dynamicScopeParameter??>
              ${advancedMsg(clientScope.consentScreenText)}
            <#else>
              ${advancedMsg(clientScope.consentScreenText)}: <b>${clientScope.dynamicScopeParameter}</b>
            </#if>
          </li>
        </#list>
      </#if>
    </ul>
    <#if client.attributes.policyUri?? || client.attributes.tosUri??>
      <h3>
        <#if client.name?has_content>
          ${msg("oauthGrantInformation",advancedMsg(client.name))}
        <#else>
          ${msg("oauthGrantInformation",client.clientId)}
        </#if>
        <#if client.attributes.tosUri??>
          ${msg("oauthGrantReview")}
          <a href="${client.attributes.tosUri}" target="_blank">${msg("oauthGrantTos")}</a>
        </#if>
        <#if client.attributes.policyUri??>
          ${msg("oauthGrantReview")}
          <a href="${client.attributes.policyUri}" target="_blank">${msg("oauthGrantPolicy")}</a>
        </#if>
      </h3>
    </#if>
    <@form.kw action=url.oauthAction method="post">
      <input name="code" type="hidden" value="${oauth.code}">
      <@buttonGroup.kw>
        <@button.kw color="primary" name="accept" type="submit">
          ${msg("doYes")}
        </@button.kw>
        <@button.kw color="secondary" name="cancel" type="submit">
          ${msg("doNo")}
        </@button.kw>
      </@buttonGroup.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

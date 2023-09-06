<#import "document.ftl" as document>
<#import "components/atoms/alert.ftl" as alert>
<#import "components/atoms/body.ftl" as body>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/card.ftl" as card>
<#import "components/atoms/container.ftl" as container>
<#import "components/atoms/heading.ftl" as heading>
<#import "components/atoms/logo.ftl" as logo>
<#import "components/atoms/nav.ftl" as nav>
<#import "components/molecules/locale-provider.ftl" as localeProvider>
<#import "components/molecules/username.ftl" as username>

<#macro
  registrationLayout
  displayInfo=false
  displayMessage=true
  displayRequiredFields=false
  script=""
  showAnotherWayIfPresent=true
>
  <#assign cardHeader>
    <@logo.kw>
      <h1>Jan</h1>
    </@logo.kw>
    <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
      <@heading.kw>
        <#nested "header">
      </@heading.kw>
    <#else>
      <#nested "show-username">
      <@username.kw
        linkHref=url.loginRestartFlowUrl
        linkTitle=msg("restartLoginTooltip")
        name=auth.attemptedUsername
      />
    </#if>
  </#assign>

  <#assign cardContent>
    <#if displayMessage && message?has_content && (message.type != "warning" || !isAppInitiatedAction??)>
      <@alert.kw color=message.type>
        ${kcSanitize(message.summary)?no_esc}
      </@alert.kw>
    </#if>
    <#nested "form">
    <#if displayRequiredFields>
      <p class="text-secondary-600 text-sm">
        * ${msg("requiredFields")}
      </p>
    </#if>
    <#if auth?has_content && auth.showTryAnotherWayLink() && showAnotherWayIfPresent>
      <form action="${url.loginAction}" method="post">
        <input name="tryAnotherWay" type="hidden" value="on" />
        <@button.kw color="primary" type="submit">
          ${msg("doTryAnotherWay")}
        </@button.kw>
      </form>
    </#if>
    <#nested "socialProviders">
  </#assign>

  <#assign cardFooter>
    <#if displayInfo>
      <#nested "info">
    </#if>
  </#assign>

  <html>
    <head>
      <@document.kw script=script />
    </head>
    <@body.kw>
      <@container.kw>
        <@card.kw content=cardContent footer=cardFooter header=cardHeader />
        <@nav.kw>
          <#nested "nav">
          <#if realm.internationalizationEnabled && locale.supported?size gt 1>
            <@localeProvider.kw currentLocale=locale.current locales=locale.supported />
          </#if>
        </@nav.kw>
      </@container.kw>
    </@body.kw>
  </html>
</#macro>

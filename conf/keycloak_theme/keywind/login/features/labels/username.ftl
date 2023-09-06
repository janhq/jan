<#macro kw>
  <#compress>
    <#if !realm.loginWithEmailAllowed>
      ${msg("username")}
    <#elseif !realm.registrationEmailAsUsername>
      ${msg("usernameOrEmail")}
    <#else>
      ${msg("email")}
    </#if>
  </#compress>
</#macro>

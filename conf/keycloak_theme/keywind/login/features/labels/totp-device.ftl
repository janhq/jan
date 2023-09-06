<#macro kw>
  <#compress>
    ${msg("loginTotpDeviceName")} <#if totp.otpCredentials?size gte 1>*</#if>
  </#compress>
</#macro>

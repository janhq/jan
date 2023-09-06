<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/form.ftl" as form>

<@layout.registrationLayout; section>
  <#if section="header">
    ${msg("confirmLinkIdpTitle")}
  <#elseif section="form">
    <@form.kw action=url.loginAction method="post">
      <@button.kw color="primary" name="submitAction" type="submit" value="updateProfile">
        ${msg("confirmLinkIdpReviewProfile")}
      </@button.kw>
      <@button.kw color="primary" name="submitAction" type="submit" value="linkAccount">
        ${msg("confirmLinkIdpContinue", idpDisplayName)}
      </@button.kw>
    </@form.kw>
  </#if>
</@layout.registrationLayout>

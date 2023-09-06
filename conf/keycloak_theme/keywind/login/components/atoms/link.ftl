<#macro kw color="" component="a" size="" rest...>
  <#switch color>
    <#case "primary">
      <#assign colorClass="text-primary-600 hover:text-primary-500">
      <#break>
    <#case "secondary">
      <#assign colorClass="text-secondary-600 hover:text-secondary-900">
      <#break>
    <#default>
      <#assign colorClass="text-primary-600 hover:text-primary-500">
  </#switch>

  <#switch size>
    <#case "small">
      <#assign sizeClass="text-sm">
      <#break>
    <#default>
      <#assign sizeClass="">
  </#switch>

  <${component}
    class="<#compress>${colorClass} ${sizeClass} inline-flex</#compress>"

    <#list rest as attrName, attrValue>
      ${attrName}="${attrValue}"
    </#list>
  >
    <#nested>
  </${component}>
</#macro>

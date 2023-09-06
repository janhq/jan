<#macro kw color="">
  <#switch color>
    <#case "error">
      <#assign colorClass="bg-red-100 text-red-600">
      <#break>
    <#case "info">
      <#assign colorClass="bg-blue-100 text-blue-600">
      <#break>
    <#case "success">
      <#assign colorClass="bg-green-100 text-green-600">
      <#break>
    <#case "warning">
      <#assign colorClass="bg-orange-100 text-orange-600">
      <#break>
    <#default>
      <#assign colorClass="bg-blue-100 text-blue-600">
  </#switch>

  <div class="${colorClass} p-4 rounded-lg text-sm" role="alert">
    <#nested>
  </div>
</#macro>

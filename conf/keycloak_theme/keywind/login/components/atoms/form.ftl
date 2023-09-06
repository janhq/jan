<#macro kw rest...>
  <form
    class="m-0 space-y-4"

    <#list rest as attrName, attrValue>
      ${attrName}="${attrValue}"
    </#list>
  >
    <#nested>
  </form>
</#macro>

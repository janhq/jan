export default function useGetModelApiInfo() {
  const data = [
    {
      type: "cURL",
      stringCode: `import SyntaxHighlighter from 'react-syntax-highlighter';
      import { docco } from 'react-syntax-highlighter/dist/esm/styles/hljs';
      const Component = () => {
        const codeString = '(num) => num + 1';
        return (
          <SyntaxHighlighter language="javascript" style={docco}>
            {codeString}
          </SyntaxHighlighter>
        );
      };`,
    },
    {
      type: "Python",
      stringCode: `# This function adds two numbers
      def add(x, y):
          return x + y
      
      # This function subtracts two numbers
      def subtract(x, y):
          return x - y
      
      # This function multiplies two numbers
      def multiply(x, y):
          return x * y
      
      # This function divides two numbers
      def divide(x, y):
          return x / y
      
      
      print("Select operation.")
      print("1.Add")
      print("2.Subtract")
      print("3.Multiply")
      print("4.Divide")`,
    },
    {
      type: "Node",
      stringCode: `var express = require('express');
      var app = express();
      
      app.get('/', function (req, res) {
         res.send('Hello World');
      })
      
      var server = app.listen(8081, function () {
        var host = server.address().address
        var port = server.address().port      
      })
      `,
    },
    {
      type: "JSON",
      stringCode: `{"menu": {
        "id": "file",
        "value": "File",
        "popup": {
          "menuitem": [
            {"value": "New", "onclick": "CreateNewDoc()"},
            {"value": "Open", "onclick": "OpenDoc()"},
            {"value": "Close", "onclick": "CloseDoc()"}
          ]
        }
      }}`,
    },
  ];

  return {
    data,
  };
}

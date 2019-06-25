// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

const path = require('path');
const fs = require('fs');

function fetch(url) {
  let fulfill, reject;
  const promise = new Promise((res, rej) => {
    fulfill = res;
    reject = rej;
  });
  const driver = url.startsWith('https://') ? require('https') : require('http');
  const request = driver.get(url, response => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', chunk => data += chunk);
    response.on('end', () => fulfill(data));
    response.on('error', reject);
  });
  request.on('error', reject);
  return promise;
};

async function generate() {
  const json = JSON.parse(await fetch('https://raw.githubusercontent.com/microsoft/debug-adapter-protocol/gh-pages/debugAdapterProtocol.json'));

  const result = [
    `/*---------------------------------------------------------`,
    ` * Copyright (C) Microsoft Corporation. All rights reserved.`,
    ` *--------------------------------------------------------*/`,
    ``,
    `/****************************************************************`,
    ` * Auto-generated by generate-dap-api.js, do not edit manually. *`,
    ` ****************************************************************/`,
    `export namespace Dap {`,
  ];

  function appendText(text, indent) {
    if (!text)
      return;
    result.push(`${indent}/**`);
    for (const line of text.split('\n'))
      result.push(`${indent} * ${line}`);
    result.push(`${indent} */`);
  }

  function createSeparator() {
    let first = true;
    return function() {
      if (!first)
        result.push(``);
      first = false;
    }
  }

  const defs = json.definitions;

  function definition(name) {
    return name.substring('#/definitions/'.length);
  }

  const types = [];
  const typesSet = new Set();

  function generateType(prop) {
    if (prop._enum)
      return `${prop._enum.map(value => `'${value}'`).join(' | ')}`;
    if (prop['$ref']) {
      const def = definition(prop['$ref']);
      if (!typesSet.has(def)) {
        types.push(def);
        typesSet.add(def);
      }
      return `${def}`;
    }
    if (Array.isArray(prop.type)) {
      return `${prop.type.map(type => generateType({type})).join(' | ')}`;
    }
    if (prop.type === 'array') {
      const subtype = prop.items ? generateType(prop.items) : 'any';
      return `${subtype}[]`;
    }
    if (prop.type === 'integer')
      return 'number';
    return prop.type;
  }

  function appendProps(props, required, indent) {
    required = new Set(required || []);
    const propSeparator = createSeparator();
    for (const name in props) {
      const prop = props[name];
      propSeparator();
      appendText(prop.description, '    ');
      const generatedType = generateType(prop);
      result.push(`${indent}${name}${required.has(name) ? '' : '?'}: ${generatedType};`);
    }
  }

  const stubs = [];
  const interfaceSeparator = createSeparator();

  interfaceSeparator();
  result.push(
    `  export interface Api {`,
  );
  const apiSeparator = createSeparator();
  for (const name in defs) {
    const def = defs[name];
    if (!def.allOf)
      continue;
    const ref = def.allOf.find(parent => !!parent['$ref']);
    const desc = def.allOf.find(parent => !parent['$ref']);
    if (!ref)
      continue;
    if (ref['$ref'] === '#/definitions/Event') {
      apiSeparator();
      appendText(desc.description, '    ');
      result.push(`    ${desc.properties.event.enum[0]}(params: ${name}Params): void;`);
      stubs.push({type: 'event', name: `${name}Params`, value: desc.properties.body || {properties: {}}});
    }
    if (ref['$ref'] === '#/definitions/Request' && desc.title !== 'Reverse Requests') {
      const short = desc.properties.command.enum[0];
      const title = short.substring(0, 1).toUpperCase() + short.substring(1);
      apiSeparator();
      appendText(desc.description, '    ');
      result.push(`    on(request: '${short}', handler: (params: ${title}Params) => Promise<${title}Result>): void;`);
      const args = desc.properties.arguments ? desc.properties.arguments['$ref'] : '#/definitions/';
      stubs.push({type: 'params', name: `${title}Params`, value: defs[definition(args)] || {properties: {}}});
      stubs.push({type: 'result', name: `${title}Result`, value: defs[`${name.substring(0, name.length - 'Request'.length)}Response`]});
    }
  }
  result.push(
    `  }`
  );

  stubs.sort((a, b) => a.name < b.name ? -1 : 1);
  for (const type of stubs) {
    interfaceSeparator();
    result.push(
      `  export interface ${type.name} {`
    );
    if (type.type === 'result') {
      const desc = type.value.allOf.find(parent => !parent['$ref']);
      type.value = desc.properties ? desc.properties.body : {properties: {}};
      while (type.value['$ref'])
        type.value = defs[definition(type.value['$ref'])];
    }
    appendProps(type.value.properties, type.value.required, '    ');
    result.push(
      `  }`,
    );
  }

  while (types.length) {
    const type = types.pop();
    const def = defs[type];
    interfaceSeparator();
    appendText(def.description, '  ');
    if (def.type !== 'object') {
      result.push(`  export type ${type} = ${def.type};`);
    } else {
      result.push(`  export interface ${type} {`);
      appendProps(def.properties, def.required, '    ');
      result.push(`  }`);
    }
  }

  result.push(
    `}`,
    ``,
    `export default Dap;`,
    ``,
  );

  const fileName = path.join(__dirname, '../src/dap/api.d.ts');
  fs.writeFileSync(fileName, result.join('\n'));
}

generate();

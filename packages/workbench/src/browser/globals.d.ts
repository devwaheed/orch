declare module 'react/jsx-runtime' {
  import type * as React from 'react';
  export { Fragment } from 'react';

  export namespace JSX {
    type ElementType = React.JSX.ElementType;
    type Element = React.JSX.Element;
    type ElementClass = React.JSX.ElementClass;
    type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
    type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }

  export function jsx(
    type: React.ElementType,
    props: unknown,
    key?: React.Key
  ): React.ReactElement;

  export function jsxs(
    type: React.ElementType,
    props: unknown,
    key?: React.Key
  ): React.ReactElement;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

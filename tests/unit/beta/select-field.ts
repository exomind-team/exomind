import { fireEvent, screen,waitFor } from '@testing-library/react';

/** Select the same catalog value through the themed keyboard/touch surface. */
export async function selectField(trigger:HTMLElement,value:string):Promise<void> {
  await waitFor(()=>{if(trigger.hasAttribute('disabled'))throw new Error('Selector is still preparing its current scope');});
  fireEvent.keyDown(trigger,{key:'ArrowDown'});
  const options=await screen.findAllByRole('option');const option=options.find(option=>option.getAttribute('data-option-value')===value);
  if(!option)throw new Error(`Expected a rendered option for ${value}`);
  fireEvent.click(option);
}

import { createContext, useContext } from 'react';

export const PickerContext = createContext<{ openPicker: () => void }>({ openPicker: () => undefined });
export const usePicker = () => useContext(PickerContext);

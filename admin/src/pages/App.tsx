import { Routes, Route } from 'react-router-dom';
import { HomePage } from './HomePage';

const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
    </Routes>
  );
};

export { App };

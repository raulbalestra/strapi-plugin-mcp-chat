import { Routes, Route } from 'react-router-dom';
import { HomePage } from './HomePage';
import { ProvisionPage } from './ProvisionPage';

const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="provision" element={<ProvisionPage />} />
    </Routes>
  );
};

export { App };

import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { PdfDropzone } from './components/PdfDropzone';

export function App() {
  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        <section className="card" aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="card-title">
            Przeanalizuj dokument PDF
          </h2>
          <PdfDropzone />
        </section>
      </main>
      <AppFooter />
    </div>
  );
}

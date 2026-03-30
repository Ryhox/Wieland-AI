import { useState, useRef, useEffect } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import '../styles/Contact.css';
import '../styles/main.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

function Contact({ isSidebarOpen, onSidebarToggle }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [formData, setFormData] = useState({ 
    name: '', 
    email: '', 
    subject: '', 
    message: '',
    agreeToTerms: false
  });
  const [errors, setErrors] = useState({});
  const [modal, setModal] = useState({ show: false, title: '', message: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const heroRef = useRef(null);
  const formRef = useRef(null);
  const infoRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.set('.contact-hero > *', { opacity: 0, y: 44 });
      gsap.set('.contact-divider', { opacity: 0, x: -24 });
      gsap.set('.contact-form-wrapper', { opacity: 0, y: 44 });
      gsap.set('.contact-info-section', { opacity: 0, y: 44 });

      const tl = gsap.timeline();
      tl.to('.contact-hero > *', { 
        opacity: 1, 
        y: 0, 
        duration: 0.55, 
        stagger: 0.07, 
        ease: 'power3.out' 
      })
      .to('.contact-divider', { 
        opacity: 1, 
        x: 0, 
        duration: 0.15, 
        ease: 'power2.out' 
      }, '-=0.15')
      .to('.contact-form-wrapper', { 
        opacity: 1, 
        y: 0, 
        duration: 0.65, 
        ease: 'power3.out' 
      }, '+=0.1')
      .to('.contact-info-section', { 
        opacity: 1, 
        y: 0, 
        duration: 0.65, 
        ease: 'power3.out' 
      }, '-=0.3');
    });

    return () => ctx.revert();
  }, []);

  const showSuccessModal = () => {
    setModal({
      show: true,
      title: t('contact.successTitle'),
      message: t('contact.successMessage')
    });
    
    gsap.fromTo('.contact-form-wrapper',
      { 
        boxShadow: '0 0 0px rgba(76, 175, 80, 0)',
        borderColor: 'rgba(255, 255, 255, 0.08)'
      },
      { 
        boxShadow: '0 0 30px rgba(76, 175, 80, 0.3)',
        borderColor: 'rgba(76, 175, 80, 0.5)',
        duration: 0.5,
        yoyo: true,
        repeat: 1
      }
    );
  };

  const closeModal = () => {
    gsap.to('.contact-success-modal', {
      scale: 0.95,
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => setModal({ show: false, title: '', message: '' })
    });
  };

  const validateField = (name, value) => {
    let error = '';
    
    switch (name) {
      case 'name':
        if (!value.trim()) error = t('contact.validation.name');
        break;
      case 'email':
        if (!value.trim()) {
          error = t('contact.validation.email');
        } else {
          const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
          if (!emailRegex.test(value)) {
            error = t('contact.validation.emailInvalid');
          }
        }
        break;
      case 'subject':
        if (!value.trim()) error = t('contact.validation.subject');
        break;
      case 'message':
        if (!value.trim()) {
          error = t('contact.validation.message');
        } else if (value.trim().length < 10) {
          error = t('contact.validation.messageMin');
        }
        break;
      case 'agreeToTerms':
        if (!value) error = t('contact.validation.agree');
        break;
      default:
        break;
    }
    
    return error;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const fieldValue = type === 'checkbox' ? checked : value;
    setFormData(prev => ({ ...prev, [name]: fieldValue }));
    
    if (errors[name]) {
      const error = validateField(name, fieldValue);
      if (!error) {
        setErrors(prev => ({ ...prev, [name]: '' }));
      }
    }
  };

  const handleBlur = (e) => {
    const { name, value, type, checked } = e.target;
    const fieldValue = type === 'checkbox' ? checked : value;
    const error = validateField(name, fieldValue);
    setErrors(prev => ({ ...prev, [name]: error }));
    
    if (error && name !== 'agreeToTerms') {
      gsap.fromTo(`.contact-error-${name}`,
        { x: -10, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.3, ease: 'back.out' }
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const newErrors = {};
    let hasError = false;
    
    Object.keys(formData).forEach(key => {
      const error = validateField(key, formData[key]);
      if (error) {
        newErrors[key] = error;
        hasError = true;
      }
    });
    
    setErrors(newErrors);
    
    if (hasError) {
      const firstErrorField = document.querySelector('.contact-form-group input.error, .contact-form-group textarea.error, .contact-checkbox-group.error');
      if (firstErrorField) {
        firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        gsap.fromTo(firstErrorField,
          { x: -5, borderColor: 'rgba(244, 67, 54, 0.5)' },
          { x: 0, duration: 0.3, yoyo: true, repeat: 2 }
        );
      }
      return;
    }
    
    setIsSubmitting(true);
    
    gsap.to('.contact-submit-btn', {
      scale: 0.98,
      duration: 0.2,
      yoyo: true,
      repeat: 2
    });
    
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (response.ok) {
        showSuccessModal();
        setFormData({ name: '', email: '', subject: '', message: '', agreeToTerms: false });
        setErrors({});
        
        gsap.fromTo('.contact-form',
          { opacity: 0.5 },
          { opacity: 1, duration: 0.5, ease: 'power2.out' }
        );
      } else {
        const errorData = await response.json();
        const formError = document.querySelector('.contact-form-error');
        if (formError) {
          formError.textContent = errorData.message || t('contact.errorSend');
          formError.style.display = 'block';
          gsap.fromTo(formError,
            { y: -20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3 }
          );
          setTimeout(() => {
            gsap.to(formError, { opacity: 0, duration: 0.3, onComplete: () => {
              formError.style.display = 'none';
              formError.textContent = '';
            }});
          }, 5000);
        }
      }
    } catch (err) {
      console.error('Fehler beim Senden:', err);
      const formError = document.querySelector('.contact-form-error');
      if (formError) {
        formError.textContent = t('contact.errorNetwork');
        formError.style.display = 'block';
        gsap.fromTo(formError,
          { y: -20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.3 }
        );
        setTimeout(() => {
          gsap.to(formError, { opacity: 0, duration: 0.3, onComplete: () => {
            formError.style.display = 'none';
            formError.textContent = '';
          }});
        }, 5000);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`page-wrapper content-page ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <Header isSidebarOpen={isSidebarOpen} onSidebarToggle={onSidebarToggle} />
      {user && <Sidebar isOpen={isSidebarOpen} onOpenChange={onSidebarToggle} />}

      <main className="page-content">
        <div className="page-container contact-container">

          <div className="contact-hero" ref={heroRef}>
            <span className="contact-eyebrow">{t('contact.eyebrow')}</span>
            <h1 className="contact-h1">{t('contact.title')}<br /><span>{t('contact.titleAccent')}</span></h1>
            <p className="contact-lead">
              {t('contact.lead')}
            </p>
          </div>

          <div className="contact-divider" />

          <div className="contact-content" ref={formRef}>
            <div className="contact-form-wrapper">
              <h2 className="contact-form-title">{t('contact.formTitle')}</h2>
              
              <div className="contact-form-error" style={{ display: 'none' }}></div>
              
              <form onSubmit={handleSubmit} className="contact-form" noValidate>
                <div className="contact-form-row">
                  <div className="contact-form-group">
                    <label htmlFor="name">{t('contact.name')} *</label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      placeholder={t('contact.namePlaceholder')}
                      disabled={isSubmitting}
                      className={errors.name ? 'error' : ''}
                    />
                    {errors.name && (
                      <div className={`contact-error contact-error-name`}>
                        {errors.name}
                      </div>
                    )}
                  </div>

                  <div className="contact-form-group">
                    <label htmlFor="email">{t('contact.email')} *</label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      placeholder={t('contact.emailPlaceholder')}
                      disabled={isSubmitting}
                      className={errors.email ? 'error' : ''}
                    />
                    {errors.email && (
                      <div className={`contact-error contact-error-email`}>
                        {errors.email}
                      </div>
                    )}
                  </div>
                </div>

                <div className="contact-form-group">
                  <label htmlFor="subject">{t('contact.subject')} *</label>
                  <input
                    type="text"
                    id="subject"
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder={t('contact.subjectPlaceholder')}
                    disabled={isSubmitting}
                    className={errors.subject ? 'error' : ''}
                  />
                  {errors.subject && (
                    <div className={`contact-error contact-error-subject`}>
                      {errors.subject}
                    </div>
                  )}
                </div>

                <div className="contact-form-group">
                  <label htmlFor="message">{t('contact.message')} *</label>
                  <textarea
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder={t('contact.messagePlaceholder')}
                    rows="7"
                    disabled={isSubmitting}
                    className={errors.message ? 'error' : ''}
                  />
                  <span className="contact-char-count">
                    {formData.message.length} {t('contact.chars')} {formData.message.length < 10 && formData.message.length > 0 && t('contact.min10')}
                  </span>
                  {errors.message && (
                    <div className={`contact-error contact-error-message`}>
                      {errors.message}
                    </div>
                  )}
                </div>

                <div className={`contact-form-group contact-checkbox-group ${errors.agreeToTerms ? 'has-error' : ''}`}>
                  <label className="contact-checkbox-label">
                    <input
                      type="checkbox"
                      name="agreeToTerms"
                      checked={formData.agreeToTerms}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={isSubmitting}
                      className={errors.agreeToTerms ? 'error' : ''}
                    />
                    <span className="checkbox-text">
                      {t('contact.agree')} <a href={`/${i18n.language}/privacy-policy`} target="_blank" rel="noopener noreferrer">{t('contact.privacy')}</a> {t('contact.agreeEnd')}
                    </span>
                  </label>
                  {errors.agreeToTerms && (
                    <div className={`contact-error contact-error-agreeToTerms`}>
                      {errors.agreeToTerms}
                    </div>
                  )}
                </div>

                <button 
                  type="submit" 
                  className={`contact-submit-btn ${isSubmitting ? 'submitting' : ''}`}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <span className="spinner"></span>
                      {t('contact.sending')}
                    </>
                  ) : (
                    t('contact.submit')
                  )}
                </button>
              </form>
            </div>
          </div>

          <div className="contact-divider" />

          <div className="contact-info-section" ref={infoRef}>
            <h2 className="contact-info-title">{t('contact.infoTitle')}</h2>
            <div className="contact-info-grid">
              <div className="contact-info-card">
                <span className="contact-info-label">📍 {t('contact.location')}</span>
                <p>Wieland Headquarters<br />Italy</p>
              </div>
              <div className="contact-info-card">
                <span className="contact-info-label">📧 E-Mail</span>
                <p><a href="mailto:info@wieland.ai">info@wieland.ai</a></p>
              </div>
              <div className="contact-info-card">
                <span className="contact-info-label">📞 {t('contact.support')}</span>
                <p>{t('contact.supportText')}</p>
              </div>
            </div>
          </div>

        </div>
      </main>

      <Footer />

      {modal.show && (
        <div className="contact-success-backdrop" onClick={closeModal}>
          <div className="contact-success-modal" onClick={e => e.stopPropagation()}>
            <div className="contact-success-header">
              <div className="contact-success-icon">✓</div>
              <button className="contact-success-close" onClick={closeModal}>✕</button>
            </div>
            <div className="contact-success-content">
              <h2 className="contact-success-title">{modal.title}</h2>
              <p className="contact-success-message">{modal.message}</p>
              <button className="contact-success-btn" onClick={closeModal}>
                {t('common.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Contact;
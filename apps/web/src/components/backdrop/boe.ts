/**
 * Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común de las
 * Administraciones Públicas — consolidated text, título preliminar and the
 * opening articles.
 *
 * Taken verbatim from the BOE's own consolidated version of BOE-A-2015-10565.
 * It is real law rather than lorem ipsum on purpose: the backdrop is a page of
 * the corpus this product indexes, and a legal tool setting invented statute
 * behind its own sign-in would be a strange thing to ship.
 *
 * `k` is the block role — `cap` chapter number, `capt` chapter title, `art`
 * article heading, `p` body paragraph, `sub` indented sub-paragraph.
 */
type Block = { k: 'cap' | 'capt' | 'art' | 'p' | 'sub'; t: string };

const BOE: readonly Block[] = [
  {
    k: 'cap',
    t: 'TÍTULO PRELIMINAR',
  },
  {
    k: 'capt',
    t: 'Disposiciones generales',
  },
  {
    k: 'art',
    t: 'Artículo 1. Objeto de la Ley.',
  },
  {
    k: 'p',
    t: '1. La presente Ley tiene por objeto regular los requisitos de validez y eficacia de los actos administrativos, el procedimiento administrativo común a todas las Administraciones Públicas, incluyendo el sancionador y el de reclamación de responsabilidad de las Administraciones Públicas, así como los principios a los que se ha de ajustar el ejercicio de la iniciativa legislativa y la potestad reglamentaria.',
  },
  {
    k: 'p',
    t: '2. Solo mediante ley, cuando resulte eficaz, proporcionado y necesario para la consecución de los fines propios del procedimiento, y de manera motivada, podrán incluirse trámites adicionales o distintos a los contemplados en esta Ley. Reglamentariamente podrán establecerse especialidades del procedimiento referidas a los órganos competentes, plazos propios del concreto procedimiento por razón de la materia, formas de iniciación y terminación, publicación e informes a recabar.',
  },
  {
    k: 'art',
    t: 'Artículo 2. Ámbito subjetivo de aplicación.',
  },
  {
    k: 'p',
    t: '1. La presente Ley se aplica al sector público, que comprende:',
  },
  {
    k: 'p',
    t: 'a) La Administración General del Estado.',
  },
  {
    k: 'p',
    t: 'b) Las Administraciones de las Comunidades Autónomas.',
  },
  {
    k: 'p',
    t: 'c) Las Entidades que integran la Administración Local.',
  },
  {
    k: 'p',
    t: 'd) El sector público institucional.',
  },
  {
    k: 'p',
    t: '2. El sector público institucional se integra por:',
  },
  {
    k: 'p',
    t: 'a) Cualesquiera organismos públicos y entidades de derecho público vinculados o dependientes de las Administraciones Públicas.',
  },
  {
    k: 'p',
    t: 'b) Las entidades de derecho privado vinculadas o dependientes de las Administraciones Públicas, que quedarán sujetas a lo dispuesto en las normas de esta Ley que específicamente se refieran a las mismas, y en todo caso, cuando ejerzan potestades administrativas.',
  },
  {
    k: 'p',
    t: 'c) Las Universidades públicas, que se regirán por su normativa específica y supletoriamente por las previsiones de esta Ley.',
  },
  {
    k: 'p',
    t: '3. Tienen la consideración de Administraciones Públicas la Administración General del Estado, las Administraciones de las Comunidades Autónomas, las Entidades que integran la Administración Local, así como los organismos públicos y entidades de derecho público previstos en la letra a) del apartado 2 anterior.',
  },
  {
    k: 'p',
    t: '4. Las Corporaciones de Derecho Público se regirán por su normativa específica en el ejercicio de las funciones públicas que les hayan sido atribuidas por Ley o delegadas por una Administración Pública, y supletoriamente por la presente Ley.',
  },
  {
    k: 'cap',
    t: 'TÍTULO I',
  },
  {
    k: 'capt',
    t: 'De los interesados en el procedimiento',
  },
  {
    k: 'cap',
    t: 'CAPÍTULO I',
  },
  {
    k: 'capt',
    t: 'La capacidad de obrar y el concepto de interesado',
  },
  {
    k: 'art',
    t: 'Artículo 3. Capacidad de obrar.',
  },
  {
    k: 'p',
    t: 'A los efectos previstos en esta Ley, tendrán capacidad de obrar ante las Administraciones Públicas:',
  },
  {
    k: 'p',
    t: 'a) Las personas físicas o jurídicas que ostenten capacidad de obrar con arreglo a las normas civiles.',
  },
  {
    k: 'p',
    t: 'b) Los menores de edad para el ejercicio y defensa de aquellos de sus derechos e intereses cuya actuación esté permitida por el ordenamiento jurídico sin la asistencia de la persona que ejerza la patria potestad, tutela o curatela. Se exceptúa el supuesto de los menores incapacitados, cuando la extensión de la incapacitación afecte al ejercicio y defensa de los derechos o intereses de que se trate.',
  },
  {
    k: 'p',
    t: 'c) Cuando la Ley así lo declare expresamente, los grupos de afectados, las uniones y entidades sin personalidad jurídica y los patrimonios independientes o autónomos.',
  },
  {
    k: 'art',
    t: 'Artículo 4. Concepto de interesado.',
  },
  {
    k: 'p',
    t: '1. Se consideran interesados en el procedimiento administrativo:',
  },
  {
    k: 'p',
    t: 'a) Quienes lo promuevan como titulares de derechos o intereses legítimos individuales o colectivos.',
  },
  {
    k: 'p',
    t: 'b) Los que, sin haber iniciado el procedimiento, tengan derechos que puedan resultar afectados por la decisión que en el mismo se adopte.',
  },
  {
    k: 'p',
    t: 'c) Aquellos cuyos intereses legítimos, individuales o colectivos, puedan resultar afectados por la resolución y se personen en el procedimiento en tanto no haya recaído resolución definitiva.',
  },
  {
    k: 'p',
    t: '2. Las asociaciones y organizaciones representativas de intereses económicos y sociales serán titulares de intereses legítimos colectivos en los términos que la Ley reconozca.',
  },
  {
    k: 'p',
    t: '3. Cuando la condición de interesado derivase de alguna relación jurídica transmisible, el derecho-habiente sucederá en tal condición cualquiera que sea el estado del procedimiento.',
  },
  {
    k: 'art',
    t: 'Artículo 5. Representación.',
  },
  {
    k: 'p',
    t: '1. Los interesados con capacidad de obrar podrán actuar por medio de representante, entendiéndose con éste las actuaciones administrativas, salvo manifestación expresa en contra del interesado.',
  },
  {
    k: 'p',
    t: '2. Las personas físicas con capacidad de obrar y las personas jurídicas, siempre que ello esté previsto en sus Estatutos, podrán actuar en representación de otras ante las Administraciones Públicas.',
  },
  {
    k: 'p',
    t: '3. Para formular solicitudes, presentar declaraciones responsables o comunicaciones, interponer recursos, desistir de acciones y renunciar a derechos en nombre de otra persona, deberá acreditarse la representación. Para los actos y gestiones de mero trámite se presumirá aquella representación.',
  },
  {
    k: 'p',
    t: '4. La representación podrá acreditarse mediante cualquier medio válido en Derecho que deje constancia fidedigna de su existencia.',
  },
  {
    k: 'p',
    t: 'A estos efectos, se entenderá acreditada la representación realizada mediante apoderamiento apud acta efectuado por comparecencia personal o comparecencia electrónica en la correspondiente sede electrónica, o a través de la acreditación de su inscripción en el registro electrónico de apoderamientos de la Administración Pública competente.',
  },
  {
    k: 'p',
    t: '5. El órgano competente para la tramitación del procedimiento deberá incorporar al expediente administrativo acreditación de la condición de representante y de los poderes que tiene reconocidos en dicho momento. El documento electrónico que acredite el resultado de la consulta al registro electrónico de apoderamientos correspondiente tendrá la condición de acreditación a estos efectos.',
  },
  {
    k: 'p',
    t: '6. La falta o insuficiente acreditación de la representación no impedirá que se tenga por realizado el acto de que se trate, siempre que se aporte aquélla o se subsane el defecto dentro del plazo de diez días que deberá conceder al efecto el órgano administrativo, o de un plazo superior cuando las circunstancias del caso así lo requieran.',
  },
  {
    k: 'p',
    t: '7. Las Administraciones Públicas podrán habilitar con carácter general o específico a personas físicas o jurídicas autorizadas para la realización de determinadas transacciones electrónicas en representación de los interesados. Dicha habilitación deberá especificar las condiciones y obligaciones a las que se comprometen los que así adquieran la condición de representantes, y determinará la presunción de validez de la representación salvo que la normativa de aplicación prevea otra cosa. Las Administraciones Públicas podrán requerir, en cualquier momento, la acreditación de dicha representación. No obstante, siempre podrá comparecer el interesado por sí mismo en el procedimiento.',
  },
  {
    k: 'art',
    t: 'Artículo 6. Registros electrónicos de apoderamientos.',
  },
  {
    k: 'p',
    t: '1. La Administración General del Estado, las Comunidades Autónomas y las Entidades Locales dispondrán de un registro electrónico general de apoderamientos, en el que deberán inscribirse, al menos, los de carácter general otorgados apud acta, presencial o electrónicamente, por quien ostente la condición de interesado en un procedimiento administrativo a favor de representante, para actuar en su nombre ante las Administraciones Públicas. También deberá constar el bastanteo realizado del poder.',
  },
  {
    k: 'p',
    t: 'En el ámbito estatal, este registro será el Registro Electrónico de Apoderamientos de la Administración General del Estado.',
  },
  {
    k: 'p',
    t: 'Los registros generales de apoderamientos no impedirán la existencia de registros particulares en cada Organismo donde se inscriban los poderes otorgados para la realización de trámites específicos en el mismo. Cada Organismo podrá disponer de su propio registro electrónico de apoderamientos.',
  },
  {
    k: 'p',
    t: '2. Los registros electrónicos generales y particulares de apoderamientos pertenecientes a todas y cada una de las Administraciones, deberán ser plenamente interoperables entre sí, de modo que se garantice su interconexión, compatibilidad informática, así como la transmisión telemática de las solicitudes, escritos y comunicaciones que se incorporen a los mismos.',
  },
  {
    k: 'p',
    t: 'Los registros electrónicos generales y particulares de apoderamientos permitirán comprobar válidamente la representación de quienes actúen ante las Administraciones Públicas en nombre de un tercero, mediante la consulta a otros registros administrativos similares, al registro mercantil, de la propiedad, y a los protocolos notariales.',
  },
  {
    k: 'p',
    t: 'Los registros mercantiles, de la propiedad, y de los protocolos notariales serán interoperables con los registros electrónicos generales y particulares de apoderamientos.',
  },
  {
    k: 'p',
    t: '3. Los asientos que se realicen en los registros electrónicos generales y particulares de apoderamientos deberán contener, al menos, la siguiente información:',
  },
  {
    k: 'p',
    t: 'a) Nombre y apellidos o la denominación o razón social, documento nacional de identidad, número de identificación fiscal o documento equivalente del poderdante.',
  },
  {
    k: 'p',
    t: 'b) Nombre y apellidos o la denominación o razón social, documento nacional de identidad, número de identificación fiscal o documento equivalente del apoderado.',
  },
  {
    k: 'p',
    t: 'c) Fecha de inscripción.',
  },
  {
    k: 'p',
    t: 'd) Período de tiempo por el cual se otorga el poder.',
  },
  {
    k: 'p',
    t: 'e) Tipo de poder según las facultades que otorgue.',
  },
  {
    k: 'p',
    t: '4. Los poderes que se inscriban en los registros electrónicos generales y particulares de apoderamientos deberán corresponder a alguna de las siguientes tipologías:',
  },
  {
    k: 'p',
    t: 'a) Un poder general para que el apoderado pueda actuar en nombre del poderdante en cualquier actuación administrativa y ante cualquier Administración.',
  },
  {
    k: 'p',
    t: 'b) Un poder para que el apoderado pueda actuar en nombre del poderdante en cualquier actuación administrativa ante una Administración u Organismo concreto.',
  },
  {
    k: 'p',
    t: 'c) Un poder para que el apoderado pueda actuar en nombre del poderdante únicamente para la realización de determinados trámites especificados en el poder.',
  },
  {
    k: 'p',
    t: 'A tales efectos, por Orden del Ministro de Hacienda y Administraciones Públicas se aprobarán, con carácter básico, los modelos de poderes inscribibles en el registro distinguiendo si permiten la actuación ante todas las Administraciones de acuerdo con lo previsto en la letra a) anterior, ante la Administración General del Estado o ante las Entidades Locales.',
  },
  {
    k: 'p',
    t: 'Cada Comunidad Autónoma aprobará los modelos de poderes inscribibles en el registro cuando se circunscriba a actuaciones ante su respectiva Administración.',
  },
  {
    k: 'p',
    t: '5. El apoderamiento « apud acta» se otorgará mediante comparecencia electrónica en la correspondiente sede electrónica haciendo uso de los sistemas de firma electrónica previstos en esta Ley, o bien mediante comparecencia personal en las oficinas de asistencia en materia de registros.',
  },
  {
    k: 'p',
    t: '6. Los poderes inscritos en el registro tendrán una validez determinada máxima de cinco años a contar desde la fecha de inscripción. En todo caso, en cualquier momento antes de la finalización de dicho plazo el poderdante podrá revocar o prorrogar el poder. Las prórrogas otorgadas por el poderdante al registro tendrán una validez determinada máxima de cinco años a contar desde la fecha de inscripción.',
  },
  {
    k: 'p',
    t: '7. Las solicitudes de inscripción del poder, de revocación, de prórroga o de denuncia del mismo podrán dirigirse a cualquier registro, debiendo quedar inscrita esta circunstancia en el registro de la Administración u Organismo ante la que tenga efectos el poder y surtiendo efectos desde la fecha en la que se produzca dicha inscripción. Seleccionar redacción:',
  },
  {
    k: 'art',
    t: 'Artículo 7. Pluralidad de interesados.',
  },
  {
    k: 'p',
    t: 'Cuando en una solicitud, escrito o comunicación figuren varios interesados, las actuaciones a que den lugar se efectuarán con el representante o el interesado que expresamente hayan señalado, y, en su defecto, con el que figure en primer término.',
  },
  {
    k: 'art',
    t: 'Artículo 8. Nuevos interesados en el procedimiento.',
  },
  {
    k: 'p',
    t: 'Si durante la instrucción de un procedimiento que no haya tenido publicidad, se advierte la existencia de personas que sean titulares de derechos o intereses legítimos y directos cuya identificación resulte del expediente y que puedan resultar afectados por la resolución que se dicte, se comunicará a dichas personas la tramitación del procedimiento.',
  },
  {
    k: 'cap',
    t: 'CAPÍTULO II',
  },
  {
    k: 'capt',
    t: 'Identificación y firma de los interesados en el procedimiento administrativo',
  },
  {
    k: 'art',
    t: 'Artículo 9. Sistemas de identificación de los interesados en el procedimiento.',
  },
  {
    k: 'p',
    t: '1. Las Administraciones Públicas están obligadas a verificar la identidad de los interesados en el procedimiento administrativo, mediante la comprobación de su nombre y apellidos o denominación o razón social, según corresponda, que consten en el Documento Nacional de Identidad o documento identificativo equivalente.',
  },
  {
    k: 'p',
    t: '2. Los interesados podrán identificarse electrónicamente ante las Administraciones Públicas a través de cualquier sistema que cuente con un registro previo como usuario que permita garantizar su identidad. En particular, serán admitidos, los sistemas siguientes:',
  },
  {
    k: 'p',
    t: 'a) Sistemas basados en certificados electrónicos reconocidos o cualificados de firma electrónica expedidos por prestadores incluidos en la «Lista de confianza de prestadores de servicios de certificación». A estos efectos, se entienden comprendidos entre los citados certificados electrónicos reconocidos o cualificados los de persona jurídica y de entidad sin personalidad jurídica.',
  },
  {
    k: 'p',
    t: 'b) Sistemas basados en certificados electrónicos reconocidos o cualificados de sello electrónico expedidos por prestadores incluidos en la «Lista de confianza de prestadores de servicios de certificación».',
  },
  {
    k: 'p',
    t: 'c) Sistemas de clave concertada y cualquier otro sistema que las Administraciones Públicas consideren válido, en los términos y condiciones que se establezcan.',
  },
  {
    k: 'p',
    t: 'Cada Administración Pública podrá determinar si sólo admite alguno de estos sistemas para realizar determinados trámites o procedimientos, si bien la admisión de alguno de los sistemas de identificación previstos en la letra c) conllevará la admisión de todos los previstos en las letras a) y b) anteriores para ese trámite o procedimiento.',
  },
  {
    k: 'p',
    t: '3. En todo caso, la aceptación de alguno de estos sistemas por la Administración General del Estado servirá para acreditar frente a todas las Administraciones Públicas, salvo prueba en contrario, la identificación electrónica de los interesados en el procedimiento administrativo. Seleccionar redacción:',
  },
  {
    k: 'art',
    t: 'Artículo 10. Sistemas de firma admitidos por las Administraciones Públicas.',
  },
  {
    k: 'p',
    t: '1. Los interesados podrán firmar a través de cualquier medio que permita acreditar la autenticidad de la expresión de su voluntad y consentimiento, así como la integridad e inalterabilidad del documento.',
  },
  {
    k: 'p',
    t: '2. En el caso de que los interesados optaran por relacionarse con las Administraciones Públicas a través de medios electrónicos, se considerarán válidos a efectos de firma:',
  },
  {
    k: 'p',
    t: 'a) Sistemas de firma electrónica reconocida o cualificada y avanzada basados en certificados electrónicos reconocidos o cualificados de firma electrónica expedidos por prestadores incluidos en la «Lista de confianza de prestadores de servicios de certificación». A estos efectos, se entienden comprendidos entre los citados certificados electrónicos reconocidos o cualificados los de persona jurídica y de entidad sin personalidad jurídica.',
  },
  {
    k: 'p',
    t: 'b) Sistemas de sello electrónico reconocido o cualificado y de sello electrónico avanzado basados en certificados electrónicos reconocidos o cualificados de sello electrónico incluidos en la «Lista de confianza de prestadores de servicios de certificación».',
  },
  {
    k: 'p',
    t: 'c) Cualquier otro sistema que las Administraciones Públicas consideren válido, en los términos y condiciones que se establezcan.',
  },
  {
    k: 'p',
    t: 'Cada Administración Pública, Organismo o Entidad podrá determinar si sólo admite algunos de estos sistemas para realizar determinados trámites o procedimientos de su ámbito de competencia.',
  },
  {
    k: 'p',
    t: '3. Cuando así lo disponga expresamente la normativa reguladora aplicable, las Administraciones Públicas podrán admitir los sistemas de identificación contemplados en esta Ley como sistema de firma cuando permitan acreditar la autenticidad de la expresión de la voluntad y consentimiento de los interesados.',
  },
  {
    k: 'p',
    t: '4. Cuando los interesados utilicen un sistema de firma de los previstos en este artículo, su identidad se entenderá ya acreditada mediante el propio acto de la firma. Seleccionar redacción:',
  },
  {
    k: 'art',
    t: 'Artículo 11. Uso de medios de identificación y firma en el procedimiento administrativo.',
  },
  {
    k: 'p',
    t: '1. Con carácter general, para realizar cualquier actuación prevista en el procedimiento administrativo, será suficiente con que los interesados acrediten previamente su identidad a través de cualquiera de los medios de identificación previstos en esta Ley.',
  },
  {
    k: 'p',
    t: '2. Las Administraciones Públicas sólo requerirán a los interesados el uso obligatorio de firma para:',
  },
  {
    k: 'p',
    t: 'a) Formular solicitudes.',
  },
  {
    k: 'p',
    t: 'b) Presentar declaraciones responsables o comunicaciones.',
  },
  {
    k: 'p',
    t: 'c) Interponer recursos.',
  },
  {
    k: 'p',
    t: 'd) Desistir de acciones.',
  },
  {
    k: 'p',
    t: 'e) Renunciar a derechos.',
  },
  {
    k: 'art',
    t: 'Artículo 12. Asistencia en el uso de medios electrónicos a los interesados.',
  },
  {
    k: 'p',
    t: '1. Las Administraciones Públicas deberán garantizar que los interesados pueden relacionarse con la Administración a través de medios electrónicos, para lo que pondrán a su disposición los canales de acceso que sean necesarios así como los sistemas y aplicaciones que en cada caso se determinen.',
  },
] as const;

export { BOE };
export type { Block };
